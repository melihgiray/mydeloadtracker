"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SwitchCamera,
  Trophy,
  Video,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { capture } from "@/lib/track";
import { todayKey } from "@/lib/analytics/dates";
import { estimate1RM } from "@/lib/analytics/epley";
import {
  isWorkoutDraft,
  mergeScanIntoDraft,
  reconcileDraftUnits,
  WORKOUT_DRAFT_KEY,
  type WorkoutDraft,
} from "@/lib/plan-session";
import {
  MAX_SCAN_FRAMES,
  captureHintFor,
  evenlySample,
  fieldsNeedingReview,
  readingWeightForDisplay,
  scanToSetRow,
  type ScanReading,
} from "@/lib/scan-mapping";
import {
  flushScanLogQueue,
  newScanAttemptId,
  queueScanLog,
} from "@/lib/scan-log-client";
import type { ScanCaptureMode } from "@/lib/scan-log";
import type { Exercise, Units } from "@/lib/types";

/**
 * Bar scanner: camera to logged set. Every state below is reachable and
 * rendered, including the ones that used to show nothing or a raw error.
 * See docs/SCANNER_FLOW.md for the full inventory.
 */
type Phase =
  | "idle"
  | "permission" // browser dialog is up
  | "denied" // camera refused, recovery card
  | "live" // preview, then recording
  | "uploading" // frames on the wire, real progress
  | "processing" // model reading
  | "result" // reading returned
  | "failed" // something went wrong, retry offered
  | "logged"; // saved or added to the draft, with context

type FailReason =
  | "offline"
  | "timeout"
  | "server"
  | "upload"
  | "few_frames"
  | "photo"
  | "no_camera";

type LogResult =
  | {
      destination: "draft";
      name: string;
      weight: string;
      reps: string;
      setNumber: number;
    }
  | {
      destination: "database";
      name: string;
      weight: string;
      reps: string;
      setNumber: number;
      isPR: boolean;
      e1rm: number;
    };

const FAILURES: Record<FailReason, { title: string; hint: string }> = {
  offline: { title: "No connection", hint: "Reconnect, then try again. Your capture is kept." },
  timeout: { title: "That took too long", hint: "The read timed out. Try again." },
  server: { title: "Could not read that one", hint: "Give it another go in a moment." },
  upload: { title: "Upload did not finish", hint: "Check your connection, then try again." },
  few_frames: { title: "Not enough of the set", hint: "Record a little longer with the bar in frame." },
  photo: { title: "Could not open that photo", hint: "Take another one." },
  no_camera: { title: "No camera available", hint: "Take a photo instead, or log it by hand." },
};

const MAX_CLIP_SECONDS = 90;
const REQUEST_TIMEOUT_MS = 25_000;
const currentTimeMs = () => Date.now();

function standaloneSnapshot() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(listener: () => void) {
  const media = window.matchMedia?.("(display-mode: standalone)");
  if (!media) return () => {};
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ScanError extends Error {
  reason: FailReason;
  attemptId: string;
  details: Record<string, unknown>;
  constructor(reason: FailReason, attemptId: string, details: Record<string, unknown> = {}) {
    super(reason);
    this.reason = reason;
    this.attemptId = attemptId;
    this.details = details;
  }
}

/** Downscale + JPEG-compress a still photo file for upload. */
function fileToDataUrl(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/** Grab the current live-video frame as a downscaled JPEG data URL. */
function grabFrame(video: HTMLVideoElement, maxDim = 640, quality = 0.55): string | null {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

/**
 * POST the frames with real upload progress and a hard timeout. fetch cannot
 * report upload progress, so this uses XHR: on a slow connection the athlete
 * always sees movement instead of a still spinner.
 */
function postScan(
  images: string[],
  attemptId: string,
  captureMode: ScanCaptureMode,
  retry: boolean,
  client: { online: boolean; standalone: boolean; facing: "environment" | "user" },
  onProgress: (pct: number) => void,
  onUploaded: () => void,
): Promise<{ reading: ScanReading; usage?: Record<string, unknown>; attemptId: string }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return reject(new ScanError("offline", attemptId));
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/scan");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => {
      onProgress(100);
      onUploaded();
    };
    xhr.upload.onerror = () => reject(new ScanError("upload", attemptId));
    xhr.onload = () => {
      let json: {
        reading?: ScanReading;
        usage?: Record<string, unknown>;
        attemptId?: string;
        error?: string;
      } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* the server's own copy is user-safe; a parse failure is a server fault */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.reading)
        resolve({
          reading: json.reading,
          usage: json.usage,
          attemptId: json.attemptId ?? attemptId,
        });
      else reject(new ScanError("server", json?.attemptId ?? attemptId, {
        httpStatus: xhr.status,
        serverMessage: json?.error?.slice(0, 300) ?? null,
      }));
    };
    xhr.onerror = () => reject(new ScanError("offline", attemptId));
    xhr.ontimeout = () => reject(new ScanError("timeout", attemptId));
    xhr.send(JSON.stringify({ images, attemptId, captureMode, retry, client }));
  });
}

export function BarScanner({
  exercises,
  units,
  draftMode = false,
}: {
  exercises: Exercise[];
  units: Units;
  draftMode?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufRef = useRef<string[]>([]);
  const tickRef = useRef(0);
  const everyNthRef = useRef(1);
  const intervalRef = useRef<number | null>(null);
  const lastFramesRef = useRef<string[]>([]); // retry without re-capturing
  const stageRef = useRef<number | null>(null);
  const captureRunRef = useRef(0);
  const captureAttemptRef = useRef("");
  const captureModeRef = useRef<ScanCaptureMode>("unknown");
  const captureStartedAtRef = useRef(0);
  const originalFieldsRef = useRef({ exerciseId: "", weight: "", reps: "" });

  const [phase, setPhase] = useState<Phase>("idle");
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [stage, setStage] = useState(0);
  const [failure, setFailure] = useState<FailReason>("server");
  const [reading, setReading] = useState<ScanReading | null>(null);
  const [frameCount, setFrameCount] = useState(1);

  // The live stream is state, not just a ref, so attaching it can wait for the
  // render that actually puts <video> in the DOM (see the effect below).
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [camLabel, setCamLabel] = useState("");
  const [needsTap, setNeedsTap] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  // Installed-to-home-screen iOS runs a different WebKit context than Safari,
  // and camera access there has historically been restricted, so the recovery
  // advice differs. Browser display mode is an external store, so React can
  // hydrate it without a second state-setting effect.
  const standalone = useSyncExternalStore(subscribeStandalone, standaloneSnapshot, () => false);

  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [attemptReference, setAttemptReference] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [result, setResult] = useState<LogResult | null>(null);

  useEffect(() => {
    void flushScanLogQueue();
    const flush = () => void flushScanLogQueue();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (stageRef.current !== null) {
      clearInterval(stageRef.current);
      stageRef.current = null;
    }
  }, []);

  const disposeCapture = useCallback(() => {
    captureRunRef.current += 1;
    clearTimers();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [clearTimers]);

  function teardown() {
    disposeCapture();
    setStream(null);
    setVideoReady(false);
    setNeedsTap(false);
    setSlowStart(false);
  }

  useEffect(() => disposeCapture, [disposeCapture]); // release the camera on unmount

  /**
   * Attach the stream AFTER React has committed the <video> element.
   *
   * This used to run inline behind a setTimeout(0) right after the state
   * update, which raced the render: videoRef.current was often still null, the
   * null guard skipped silently, and the preview stayed black with no error at
   * all. An effect runs after commit, so the element is guaranteed to exist.
   */
  useEffect(() => {
    const v = videoRef.current;
    if (phase !== "live" || !stream || !v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    let cancelled = false;
    v.play().then(
      () => !cancelled && setNeedsTap(false),
      // Autoplay refused (iOS Low Power Mode is the usual cause). A tap is a
      // fresh user gesture, which always satisfies the policy.
      () => !cancelled && setNeedsTap(true),
    );
    return () => {
      cancelled = true;
    };
  }, [phase, stream]);

  function stopLive() {
    if (captureAttemptRef.current) {
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "capture_cancelled",
        stage: "capture",
        status: "failed",
        captureMode: "video",
        frameCount: Math.min(MAX_SCAN_FRAMES, bufRef.current.length),
        details: { reason: "athlete_cancelled", recording },
      });
    }
    teardown();
    setRecording(false);
    setCountdown(0);
    setElapsed(0);
    setPhase("idle");
  }

  function matchExercise(name?: string): string {
    if (!name) return "";
    const n = name.toLowerCase();
    return (
      exercises.find((e) => e.name.toLowerCase() === n)?.id ??
      exercises.find((e) => e.name.toLowerCase().includes(n) || n.includes(e.name.toLowerCase()))?.id ??
      ""
    );
  }

  function fail(
    reason: FailReason,
    frames: number,
    details: Record<string, unknown> = {},
    attemptId = captureAttemptRef.current || newScanAttemptId(),
  ) {
    captureAttemptRef.current = attemptId;
    setAttemptReference(attemptId.slice(0, 8).toUpperCase());
    clearTimers();
    setFailure(reason);
    setPhase("failed");
    capture("scan_failed", { reason, frames });
    queueScanLog({
      attemptId,
      event: "client_failure",
      stage: frames > 0 ? "upload" : "capture",
      status: "failed",
      captureMode: captureModeRef.current,
      frameCount: frames,
      details: { reason, ...details },
    });
  }

  // ---- capture ------------------------------------------------------------

  async function startLive(
    want: "environment" | "user" = facing,
    preserveAttempt = false,
  ) {
    if (!preserveAttempt) {
      captureAttemptRef.current = newScanAttemptId();
      setAttemptReference(captureAttemptRef.current.slice(0, 8).toUpperCase());
      setCanRetry(false);
      captureStartedAtRef.current = currentTimeMs();
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "capture_started",
        stage: "permission",
        status: "started",
        captureMode: "video",
        frameCount: 0,
        details: { requestedFacing: want, standalone },
      });
    }
    captureModeRef.current = "video";
    setSlowStart(false);
    setReading(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return fail("no_camera", 0);
    }
    setPhase("permission");
    try {
      // facingMode is a preference, not a guarantee, so we read back which
      // camera we actually got rather than assuming we got what we asked for.
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: want } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop()); // flipping
      streamRef.current = s;
      const track = s.getVideoTracks()[0];
      const actual = track?.getSettings().facingMode;
      const resolved: "environment" | "user" =
        actual === "user" || actual === "environment"
          ? actual
          : /front|user|face/i.test(track?.label ?? "")
            ? "user"
            : want;
      setFacing(resolved);
      setCamLabel(resolved === "user" ? "Front camera" : "Back camera");
      setVideoReady(false);
      setNeedsTap(false);
      setStream(s); // the effect above attaches it once <video> is committed
      setPhase("live");
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "permission_granted",
        stage: "permission",
        status: "succeeded",
        captureMode: "video",
        frameCount: 0,
        durationMs: Math.min(currentTimeMs() - captureStartedAtRef.current, 300_000),
        details: { requestedFacing: want, resolvedFacing: resolved },
      });
    } catch (err) {
      teardown();
      const name = err instanceof Error ? err.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") return fail("no_camera", 0);
      setPhase("denied");
      capture("scan_failed", { reason: "permission_denied", frames: 0 });
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "client_failure",
        stage: "permission",
        status: "failed",
        captureMode: "video",
        frameCount: 0,
        details: { reason: "permission_denied", errorName: name || null, standalone },
      });
    }
  }

  function flipCamera() {
    void startLive(facing === "environment" ? "user" : "environment", true);
  }

  // If the preview has not produced a frame after a few seconds, say so instead
  // of showing an unexplained black rectangle.
  useEffect(() => {
    if (phase !== "live" || videoReady) return;
    const t = window.setTimeout(() => setSlowStart(true), 3000);
    return () => window.clearTimeout(t);
  }, [phase, videoReady]);

  // Sample frames continuously but keep a BOUNDED, evenly-spaced buffer (<=16)
  // that always spans the whole recording, so a 5-second single and a 60-second
  // set both send a fixed, affordable number of frames covering the movement.
  async function startRecording() {
    const v = videoRef.current;
    if (!v) return;
    const captureRun = captureRunRef.current + 1;
    captureRunRef.current = captureRun;
    setRecording(true);
    for (let n = 3; n >= 1; n--) {
      setCountdown(n);
      await sleep(650);
      if (captureRunRef.current !== captureRun) return;
    }
    setCountdown(0);
    bufRef.current = [];
    tickRef.current = 0;
    everyNthRef.current = 1;
    const start = currentTimeMs();
    queueScanLog({
      attemptId: captureAttemptRef.current,
      event: "recording_started",
      stage: "capture",
      status: "started",
      captureMode: "video",
      frameCount: 0,
      durationMs: Math.min(start - captureStartedAtRef.current, 300_000),
      details: { facing },
    });
    intervalRef.current = window.setInterval(() => {
      const secs = (currentTimeMs() - start) / 1000;
      setElapsed(Math.floor(secs));
      if (secs > MAX_CLIP_SECONDS) return finishRecording();
      tickRef.current += 1;
      if (tickRef.current % everyNthRef.current !== 0) return;
      const f = grabFrame(v);
      if (f) bufRef.current.push(f);
      if (bufRef.current.length >= 16) {
        bufRef.current = bufRef.current.filter((_, i) => i % 2 === 0);
        everyNthRef.current *= 2;
      }
    }, 500);
  }

  function finishRecording() {
    // Trim here, not on the server: frames past the cap are dropped either
    // way, and uploading them costs the athlete mobile data and wait time.
    const frames = evenlySample([...bufRef.current], MAX_SCAN_FRAMES);
    teardown();
    setRecording(false);
    setCountdown(0);
    setElapsed(0);
    if (frames.length >= 2) {
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "capture_completed",
        stage: "capture",
        status: "succeeded",
        captureMode: "video",
        frameCount: frames.length,
        durationMs: Math.min(currentTimeMs() - captureStartedAtRef.current, 300_000),
        details: { facing },
      });
      void analyze(frames);
    }
    else fail("few_frames", frames.length);
  }

  async function onPhoto(file: File) {
    captureAttemptRef.current = newScanAttemptId();
    setAttemptReference(captureAttemptRef.current.slice(0, 8).toUpperCase());
    setCanRetry(false);
    captureModeRef.current = "photo";
    captureStartedAtRef.current = currentTimeMs();
    queueScanLog({
      attemptId: captureAttemptRef.current,
      event: "capture_started",
      stage: "capture",
      status: "started",
      captureMode: "photo",
      frameCount: 0,
      details: {
        mimeType: file.type.slice(0, 80),
        sourceBytes: file.size,
      },
    });
    try {
      const dataUrl = await fileToDataUrl(file);
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "capture_completed",
        stage: "capture",
        status: "succeeded",
        captureMode: "photo",
        frameCount: 1,
        durationMs: Math.min(currentTimeMs() - captureStartedAtRef.current, 300_000),
        details: { mimeType: file.type.slice(0, 80) },
      });
      await analyze([dataUrl]);
    } catch {
      fail("photo", 0);
    }
  }

  // ---- analyze ------------------------------------------------------------

  function stageLabels(frames: number): string[] {
    return frames > 1
      ? ["Reading the plates", "Identifying the lift", "Counting the reps"]
      : ["Reading the plates", "Identifying the lift"];
  }

  async function analyze(images: string[], retrying = false) {
    const attemptId = captureAttemptRef.current || newScanAttemptId();
    captureAttemptRef.current = attemptId;
    setAttemptReference(attemptId.slice(0, 8).toUpperCase());
    if (captureModeRef.current === "unknown") {
      captureModeRef.current = images.length > 1 ? "video" : "photo";
    }
    lastFramesRef.current = images;
    setCanRetry(images.length > 0);
    setFrameCount(images.length);
    setReading(null);
    setLogError(null);
    setUploadPct(0);
    setStage(0);
    setPhase("uploading");

    const labels = stageLabels(images.length);
    try {
      const { reading: r, usage, attemptId: recordedAttemptId } = await postScan(
        images,
        attemptId,
        captureModeRef.current,
        retrying,
        {
          online: navigator.onLine,
          standalone,
          facing,
        },
        (pct) => setUploadPct(pct),
        () => {
          // Upload done, the model is working: name what happens, in order.
          setPhase("processing");
          clearTimers();
          stageRef.current = window.setInterval(() => {
            setStage((s) => Math.min(labels.length - 1, s + 1));
          }, 2200);
        },
      );
      captureAttemptRef.current = recordedAttemptId;
      setAttemptReference(recordedAttemptId.slice(0, 8).toUpperCase());
      clearTimers();
      // Real token spend per scan, so the cost of a model or frame-count
      // change is measured rather than assumed.
      if (usage) capture("ai_usage", { surface: "scan", frames: images.length, ...usage });
      capture("bar_scanned", {
        detected: r.detected,
        confidence: r.confidence,
        frames: images.length,
      });
      if (!r.detected) capture("scan_failed", { reason: "no_detection", frames: images.length });
      applyReading(r);
    } catch (e) {
      if (e instanceof ScanError) {
        fail(e.reason, images.length, e.details, e.attemptId);
      } else {
        fail("server", images.length);
      }
    }
  }

  function applyReading(r: ScanReading) {
    const matchedExerciseId = matchExercise(r.exercise);
    const displayWeight = readingWeightForDisplay(r.total_weight_kg, units);
    const displayReps = r.reps && r.reps > 0 ? String(r.reps) : "";
    setReading(r);
    setExerciseId(matchedExerciseId);
    setWeight(displayWeight);
    setReps(displayReps);
    originalFieldsRef.current = {
      exerciseId: matchedExerciseId,
      weight: displayWeight,
      reps: displayReps,
    };
    setPhase("result");
  }

  function retry() {
    if (lastFramesRef.current.length > 0) void analyze(lastFramesRef.current, true);
    else setPhase("idle");
  }

  // ---- log ----------------------------------------------------------------

  function recordConfirmation(
    destination: "draft" | "database",
    name: string,
  ) {
    const original = originalFieldsRef.current;
    const corrections = {
      exercise: original.exerciseId !== exerciseId,
      weight: original.weight !== weight,
      reps: original.reps !== reps,
    };
    const corrected = Object.values(corrections).some(Boolean);
    queueScanLog({
      attemptId: captureAttemptRef.current || newScanAttemptId(),
      event: "set_confirmed",
      stage: "confirmation",
      status: corrected ? "corrected" : "succeeded",
      captureMode: captureModeRef.current,
      frameCount,
      details: {
        destination,
        exerciseId,
        exerciseName: name,
        weight,
        units,
        reps,
        confidence: reading?.confidence ?? null,
        corrections,
      },
    });
  }

  async function logSet() {
    const row = scanToSetRow({ weight, reps }, units);
    if (!exerciseId || !row) {
      setLogError("Pick the lift, and check the weight and reps.");
      queueScanLog({
        attemptId: captureAttemptRef.current || newScanAttemptId(),
        event: "confirmation_blocked",
        stage: "confirmation",
        status: "failed",
        captureMode: captureModeRef.current,
        frameCount,
        details: {
          reason: "invalid_confirmed_fields",
          hasExercise: Boolean(exerciseId),
          hasWeight: Boolean(weight),
          hasReps: Boolean(reps),
        },
      });
      return;
    }
    setLogging(true);
    setLogError(null);
    try {
      const name = exercises.find((e) => e.id === exerciseId)?.name ?? "Set";
      if (draftMode) {
        try {
          const raw = localStorage.getItem(WORKOUT_DRAFT_KEY);
          let draft: WorkoutDraft = { date: todayKey(), notes: "", entries: [], units };
          if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (!isWorkoutDraft(parsed)) throw new Error("invalid draft");
            draft = reconcileDraftUnits(parsed, units);
          }

          const merged = mergeScanIntoDraft(draft, exerciseId, {
            reps: String(row.reps),
            weight,
            rpe: "",
            origin: "scan",
          });
          localStorage.setItem(WORKOUT_DRAFT_KEY, JSON.stringify(merged.draft));
          capture("scan_added_to_draft", {
            exercise_id: exerciseId,
            set_number: merged.setNumber,
          });
          recordConfirmation("draft", name);
          setResult({
            destination: "draft",
            name,
            weight,
            reps: String(row.reps),
            setNumber: merged.setNumber,
          });
          setPhase("logged");
          return;
        } catch {
          throw new Error("Could not update your workout draft.");
        }
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You are not signed in.");

      // Read history BEFORE inserting, so "set N today" and the personal-best
      // check are both honest comparisons against what came before this set.
      const { data: prior } = await supabase
        .from("workout_sets")
        .select("reps, weight, workout_sessions!inner(performed_at)")
        .eq("exercise_id", exerciseId);
      const rows = (prior ?? []) as unknown as {
        reps: number;
        weight: number;
        workout_sessions: { performed_at: string };
      }[];
      const today = new Date();
      const isToday = (iso: string) => {
        const d = new Date(iso);
        return (
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate()
        );
      };
      const setsToday = rows.filter((r) => isToday(r.workout_sessions.performed_at)).length;
      const priorBest = rows.reduce((m, r) => Math.max(m, estimate1RM(r.weight, r.reps)), 0);

      // Append to today's session rather than creating one workout per scan.
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const { data: openSession } = await supabase
        .from("workout_sessions")
        .select("id")
        .gte("performed_at", startOfDay.toISOString())
        .order("performed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let sessionId = openSession?.id as string | undefined;
      if (!sessionId) {
        const { data: created, error: sErr } = await supabase
          .from("workout_sessions")
          .insert({ user_id: user.id, performed_at: new Date().toISOString(), notes: "Scanned" })
          .select("id")
          .single();
        if (sErr || !created) throw new Error("Could not start a session.");
        sessionId = created.id;
      }

      const { count } = await supabase
        .from("workout_sets")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("exercise_id", exerciseId);

      const { error: setErr } = await supabase.from("workout_sets").insert({
        session_id: sessionId,
        exercise_id: exerciseId,
        user_id: user.id,
        set_number: (count ?? 0) + 1,
        ...row,
      });
      if (setErr) throw new Error("Could not save the set.");

      const e1rmKg = estimate1RM(row.weight, row.reps);
      capture("workout_logged", { sets: 1, exercises: 1, edit: false, source: "scan" });
      recordConfirmation("database", name);
      setResult({
        destination: "database",
        name,
        weight,
        reps: String(row.reps),
        setNumber: setsToday + 1,
        isPR: e1rmKg > priorBest,
        e1rm: Math.round(units === "lb" ? e1rmKg * 2.2046226218 : e1rmKg),
      });
      setPhase("logged");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the set.";
      setLogError(message);
      queueScanLog({
        attemptId: captureAttemptRef.current || newScanAttemptId(),
        event: "set_log_failed",
        stage: "logging",
        status: "failed",
        captureMode: captureModeRef.current,
        frameCount,
        details: { message: message.slice(0, 300), draftMode },
      });
    } finally {
      setLogging(false);
    }
  }

  function scanAgain() {
    if (reading && captureAttemptRef.current && phase === "result") {
      queueScanLog({
        attemptId: captureAttemptRef.current,
        event: "result_discarded",
        stage: "confirmation",
        status: "failed",
        captureMode: captureModeRef.current,
        frameCount,
        details: {
          reason: "new_capture_requested",
          detected: reading.detected,
          confidence: reading.confidence,
        },
      });
    }
    setReading(null);
    setResult(null);
    setLogError(null);
    lastFramesRef.current = [];
    setCanRetry(false);
    captureAttemptRef.current = "";
    setAttemptReference("");
    captureModeRef.current = "unknown";
    captureStartedAtRef.current = 0;
    originalFieldsRef.current = { exerciseId: "", weight: "", reps: "" };
    setPhase("idle");
  }

  // ---- render -------------------------------------------------------------

  const review = reading ? fieldsNeedingReview(reading, exerciseId, frameCount) : null;
  const hint = reading ? captureHintFor(reading, frameCount) : null;
  const labels = stageLabels(frameCount);
  const reviewState = {
    exercise: Boolean(review?.exercise || !exerciseId),
    weight: Boolean(review?.weight || !(Number(weight) > 0)),
    reps: Boolean(review?.reps || !(Number(reps) > 0)),
  };
  const reviewCount = [reviewState.exercise, reviewState.weight, reviewState.reps]
    .filter(Boolean).length;
  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPhoto(f);
          e.target.value = "";
        }}
      />

      {/* IDLE: one obvious path, with lower-friction fallbacks kept secondary. */}
      {phase === "idle" && (
        <div className="panel overflow-hidden p-0">
          <button
            onClick={() => void startLive()}
            className="tap group flex min-h-32 w-full items-center gap-4 border-b border-border bg-brand/10 px-5 py-6 text-left transition-colors hover:bg-brand/15"
          >
            <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl bg-brand text-brand-foreground shadow-lg shadow-brand/20">
              <Video className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold">Record a set</span>
              <span className="mt-1 block text-sm leading-snug text-muted">
                Reads the lift, weight, and reps
              </span>
            </span>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-brand transition-transform group-hover:translate-x-0.5" />
          </button>

          <div className="grid grid-cols-2 divide-x divide-border">
            <button
              onClick={() => fileRef.current?.click()}
              className="tap flex min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center transition-colors hover:bg-surface-hover"
            >
              <ImageIcon className="h-5 w-5 text-brand" />
              <span>
                <span className="block text-sm font-semibold">Take a photo</span>
                <span className="mt-0.5 block text-xs text-muted">Weight only</span>
              </span>
            </button>
            <Link
              href="/log"
              className="tap flex min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center transition-colors hover:bg-surface-hover"
            >
              <span className="grid h-5 w-5 place-items-center text-brand">
                <span className="text-lg font-semibold leading-none">+</span>
              </span>
              <span>
                <span className="block text-sm font-semibold">Log manually</span>
                <span className="mt-0.5 block text-xs text-muted">Skip the camera</span>
              </span>
            </Link>
          </div>

          <div className="flex items-start gap-2.5 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
            <p>Only a few still frames are analyzed. No photo or video is stored.</p>
          </div>
        </div>
      )}

      {/* PERMISSION PENDING: this used to render nothing at all */}
      {phase === "permission" && (
        <div className="card flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-brand" />
          <div>
            <p className="font-medium">Waiting for camera access</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Choose Allow so the camera can read the bar. You can change this later.
            </p>
          </div>
        </div>
      )}

      {/* PERMISSION DENIED: recovery, never a dead end */}
      {phase === "denied" && (
        <div className="card space-y-3">
          <p className="font-medium">Camera access is off</p>
          {standalone ? (
            <p className="text-sm leading-relaxed text-muted">
              This is the app installed on your home screen, and iPhone keeps its camera
              permission separate from Safari. Open mydeloadtracker.vercel.app in Safari and
              allow the camera there, or check Settings, Apps, Safari, Camera. Taking a photo
              works here either way.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              To turn it on, tap the icon at the left of the address bar, allow the camera, then
              reload. On iPhone it is also under Settings, Apps, Safari, Camera.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void startLive()} className="btn-brand">
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn-ghost">
              <Camera className="h-4 w-4" />
              Take a photo
            </button>
            <Link href="/log" className="btn-ghost">
              Log by hand
            </Link>
          </div>
        </div>
      )}

      {/* LIVE PREVIEW + RECORDING */}
      {phase === "live" && (
        <div className="card relative overflow-hidden p-0">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            onLoadedMetadata={() => {
              setVideoReady(true);
              setSlowStart(false);
            }}
            onPlaying={() => {
              setVideoReady(true);
              setNeedsTap(false);
              setSlowStart(false);
            }}
            className="aspect-[3/4] w-full bg-black object-cover sm:aspect-video"
          />

          {/* Autoplay was refused, usually iOS Low Power Mode. A tap is a fresh
              user gesture, which the policy always allows. */}
          {needsTap && (
            <button
              onClick={() => void videoRef.current?.play().catch(() => {})}
              className="absolute inset-0 grid place-items-center bg-black/60 text-sm font-medium text-white"
            >
              Tap to start the camera
            </button>
          )}

          {!needsTap && !videoReady && slowStart && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center">
              <div>
                <p className="text-sm font-medium text-white">The preview is not starting</p>
                <p className="mt-1 text-xs leading-relaxed text-white/70">
                  Close any other app using the camera, or take a photo instead.
                </p>
              </div>
            </div>
          )}

          {countdown > 0 && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 text-6xl font-bold tabular-nums text-white">
              {countdown}
            </div>
          )}

          {/* Which camera is actually live, read back from the track, plus a
              way to switch. iOS can ignore the facingMode preference. */}
          {!recording && countdown === 0 && (
            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <p className="rounded-full bg-black/55 px-3 py-1.5 text-xs text-white">
                Bar and plates in frame, from the side
              </p>
              <button
                onClick={flipCamera}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white"
              >
                <SwitchCamera className="h-3.5 w-3.5" />
                {camLabel || "Camera"}
              </button>
            </div>
          )}
          {recording && countdown === 0 && (
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-danger/90 px-3 py-1.5 text-xs font-semibold tabular-nums text-danger-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger-foreground" />
              Recording {elapsed}s
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-4 pt-10">
            <button
              onClick={stopLive}
              className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur"
              aria-label="Cancel"
            >
              <X className="h-5 w-5" />
            </button>
            {recording && countdown === 0 ? (
              <button
                onClick={finishRecording}
                className="flex h-14 items-center gap-2 rounded-full bg-danger px-6 text-sm font-semibold text-danger-foreground shadow-lg shadow-black/30"
              >
                <CircleStop className="h-5 w-5" />
                Stop and read
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={recording}
                className="flex h-14 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-lg shadow-black/30 disabled:opacity-60"
              >
                <span className="h-3 w-3 rounded-full bg-current" />
                Record a set
              </button>
            )}
            <span className="h-12 w-12" aria-hidden />
          </div>
        </div>
      )}

      {/* UPLOADING: real progress, so a slow connection never looks frozen */}
      {phase === "uploading" && (
        <div className="panel space-y-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
            <div>
              <p className="font-semibold">Sending your capture</p>
              <p className="text-xs text-muted">
                {frameCount === 1 ? "One photo" : `${frameCount} still frames`}
              </p>
            </div>
            <span className="ml-auto text-sm tabular-nums text-muted">{uploadPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-brand transition-all duration-200"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      {/* PROCESSING: name what is happening, in order */}
      {phase === "processing" && (
        <div className="panel space-y-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand">
              <ScanLine className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">{labels[stage]}</p>
              <p className="text-xs text-muted">This usually takes a few seconds</p>
            </div>
            <Loader2 className="ml-auto h-4 w-4 flex-shrink-0 animate-spin text-muted" />
          </div>
          <div className="flex gap-1.5">
            {labels.map((l, i) => (
              <span
                key={l}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= stage ? "bg-brand" : "bg-border"}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* FAILURE: specific, friendly, one suggestion, always a way forward */}
      {phase === "failed" && (
        <div className="panel space-y-4" role="alert">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-danger/15 text-danger">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">{FAILURES[failure].title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{FAILURES[failure].hint}</p>
              {attemptReference && (
                <p className="micro mt-2">Scan reference {attemptReference}</p>
              )}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {canRetry && failure !== "few_frames" && (
              <button onClick={retry} className="btn-brand w-full">
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            )}
            <button onClick={scanAgain} className="btn-ghost w-full">
              <Camera className="h-4 w-4" />
              New capture
            </button>
            <Link href="/log" className="btn-ghost w-full">
              Log by hand
            </Link>
          </div>
        </div>
      )}

      {/* RESULT: the money screen */}
      {phase === "result" && reading && review && (
        <div className="panel space-y-4">
          {reading.detected ? (
            <>
              <div
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
                  reviewCount > 0
                    ? "border-warning/35 bg-warning/10"
                    : "border-success/35 bg-success/10"
                }`}
              >
                {reviewCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-warning" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {reviewCount > 0
                      ? `Check ${reviewCount} ${reviewCount === 1 ? "field" : "fields"}`
                      : "Ready to log"}
                  </p>
                  <p className="text-xs text-muted">Confirm the numbers before saving</p>
                </div>
                <span className="micro flex-shrink-0">{reading.confidence}</span>
              </div>

              <div>
                <label htmlFor="scan-exercise" className="label">Lift</label>
                <select
                  id="scan-exercise"
                  className={`input text-base ${reviewState.exercise ? "border-warning/60" : ""}`}
                  value={exerciseId}
                  onChange={(e) => {
                    setExerciseId(e.target.value);
                    setLogError(null);
                  }}
                >
                  <option value="">Pick the lift</option>
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="label">Weight ({units})</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    placeholder="0"
                    className={`input readout h-16 px-3 text-center text-3xl font-semibold ${reviewState.weight ? "border-warning/60 bg-warning/5" : "bg-background"}`}
                    value={weight}
                    onChange={(e) => {
                      setWeight(e.target.value);
                      setLogError(null);
                    }}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="label">Reps</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    className={`input readout h-16 px-3 text-center text-3xl font-semibold ${reviewState.reps ? "border-warning/60 bg-warning/5" : "bg-background"}`}
                    value={reps}
                    onChange={(e) => {
                      setReps(e.target.value);
                      setLogError(null);
                    }}
                  />
                </label>
              </div>

              <div className="rounded-xl bg-background/55 px-3.5 py-3 text-sm leading-relaxed text-muted">
                <p>{reading.note}</p>
                {reviewState.reps && !reps && frameCount === 1 ? (
                  <p className="mt-1 text-xs text-warning">A photo cannot count reps. Enter them above.</p>
                ) : hint ? (
                  <p className="mt-1 text-xs text-faint">{hint}</p>
                ) : null}
              </div>
              {logError && (
                <p className="flex items-start gap-2 text-sm text-danger" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  {logError}
                </p>
              )}

              <button onClick={logSet} disabled={logging} className="btn-brand w-full">
                {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {reading.confidence === "low"
                  ? draftMode
                    ? "Confirm and add"
                    : "Confirm and log"
                  : draftMode
                    ? "Add to workout"
                    : "Log this set"}
              </button>
              <button onClick={scanAgain} className="btn-ghost w-full">
                <Camera className="h-4 w-4" />
                Scan again
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-warning/15 text-warning">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">No loaded bar found</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {hint ?? "Get the whole bar and plates in frame, filmed from the side."}
                  </p>
                  {attemptReference && (
                    <p className="micro mt-2">Scan reference {attemptReference}</p>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={scanAgain} className="btn-brand w-full">
                  <Camera className="h-4 w-4" />
                  Try another capture
                </button>
                <Link href="/log" className="btn-ghost w-full">
                  Log by hand
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* LOGGED: the set, in context */}
      {phase === "logged" && result && (
        <div className="panel space-y-5 text-center" aria-live="polite">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success">
            {result.destination === "database" && result.isPR ? (
              <Trophy className="h-7 w-7" />
            ) : (
              <Check className="h-7 w-7" />
            )}
          </div>
          <div>
            <p className="micro mb-1 text-success">
              {result.destination === "draft" ? "Added to workout" : "Set logged"}
            </p>
            <p className="text-2xl font-semibold leading-tight">{result.name}</p>
            <p className="readout mt-1 text-3xl font-semibold tabular-nums">
              {result.weight} {units} × {result.reps}
            </p>
          </div>
          {result.destination === "draft" ? (
            <p className="text-sm text-muted">
              Set {result.setNumber} added to your workout. Review it in Log, then save the
              workout when you finish.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Set {result.setNumber} today
              <span aria-hidden> · </span>
              {result.isPR
                ? `new best estimated 1RM, ${result.e1rm} ${units}`
                : `estimated 1RM ${result.e1rm} ${units}`}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href={result.destination === "draft" ? "/log" : "/dashboard"}
              className="btn-brand w-full justify-center"
            >
              {result.destination === "draft" ? "Back to workout" : "Done"}
            </Link>
            <button onClick={scanAgain} className="btn-ghost w-full">
              <ScanLine className="h-4 w-4" />
              Scan another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
