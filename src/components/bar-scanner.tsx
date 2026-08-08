"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  Loader2,
  RefreshCw,
  ScanLine,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ScanError extends Error {
  reason: FailReason;
  constructor(reason: FailReason) {
    super(reason);
    this.reason = reason;
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
  onProgress: (pct: number) => void,
  onUploaded: () => void,
): Promise<{ reading: ScanReading; usage?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return reject(new ScanError("offline"));
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
    xhr.upload.onerror = () => reject(new ScanError("upload"));
    xhr.onload = () => {
      let json: { reading?: ScanReading; usage?: Record<string, unknown> } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* the server's own copy is user-safe; a parse failure is a server fault */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.reading)
        resolve({ reading: json.reading, usage: json.usage });
      else reject(new ScanError("server"));
    };
    xhr.onerror = () => reject(new ScanError("offline"));
    xhr.ontimeout = () => reject(new ScanError("timeout"));
    xhr.send(JSON.stringify({ images }));
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
  // advice differs. Set after mount to avoid an SSR mismatch.
  const [standalone, setStandalone] = useState(false);

  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [editing, setEditing] = useState<"exercise" | "weight" | "reps" | null>(null);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [result, setResult] = useState<LogResult | null>(null);

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

  const teardown = useCallback(() => {
    disposeCapture();
    setStream(null);
    setVideoReady(false);
    setNeedsTap(false);
  }, [disposeCapture]);

  useEffect(() => disposeCapture, [disposeCapture]); // release the camera on unmount

  useEffect(() => {
    setStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
  }, []);

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

  function fail(reason: FailReason, frames: number) {
    clearTimers();
    setFailure(reason);
    setPhase("failed");
    capture("scan_failed", { reason, frames });
  }

  // ---- capture ------------------------------------------------------------

  async function startLive(want: "environment" | "user" = facing) {
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
    } catch (err) {
      teardown();
      const name = err instanceof Error ? err.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") return fail("no_camera", 0);
      setPhase("denied");
      capture("scan_failed", { reason: "permission_denied", frames: 0 });
    }
  }

  function flipCamera() {
    void startLive(facing === "environment" ? "user" : "environment");
  }

  // If the preview has not produced a frame after a few seconds, say so instead
  // of showing an unexplained black rectangle.
  useEffect(() => {
    if (phase !== "live" || videoReady) {
      setSlowStart(false);
      return;
    }
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
    const start = Date.now();
    intervalRef.current = window.setInterval(() => {
      const secs = (Date.now() - start) / 1000;
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
    if (frames.length >= 2) void analyze(frames);
    else fail("few_frames", frames.length);
  }

  async function onPhoto(file: File) {
    try {
      const dataUrl = await fileToDataUrl(file);
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

  async function analyze(images: string[]) {
    lastFramesRef.current = images;
    setFrameCount(images.length);
    setReading(null);
    setLogError(null);
    setUploadPct(0);
    setStage(0);
    setPhase("uploading");

    const labels = stageLabels(images.length);
    try {
      const { reading: r, usage } = await postScan(
        images,
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
      fail(e instanceof ScanError ? e.reason : "server", images.length);
    }
  }

  function applyReading(r: ScanReading) {
    setReading(r);
    setExerciseId(matchExercise(r.exercise));
    setWeight(readingWeightForDisplay(r.total_weight_kg, units));
    setReps(r.reps && r.reps > 0 ? String(r.reps) : "");
    setEditing(null);
    setPhase("result");
  }

  function retry() {
    if (lastFramesRef.current.length > 0) void analyze(lastFramesRef.current);
    else setPhase("idle");
  }

  // ---- log ----------------------------------------------------------------

  async function logSet() {
    const row = scanToSetRow({ weight, reps }, units);
    if (!exerciseId || !row) {
      setLogError("Pick the lift, and check the weight and reps.");
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
      setLogError(e instanceof Error ? e.message : "Could not save the set.");
    } finally {
      setLogging(false);
    }
  }

  function scanAgain() {
    setReading(null);
    setResult(null);
    setLogError(null);
    lastFramesRef.current = [];
    setPhase("idle");
  }

  // ---- render -------------------------------------------------------------

  const review = reading ? fieldsNeedingReview(reading, exerciseId, frameCount) : null;
  const hint = reading ? captureHintFor(reading, frameCount) : null;
  const labels = stageLabels(frameCount);
  const exerciseName = exercises.find((e) => e.id === exerciseId)?.name ?? "";

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

      {/* IDLE: the two ways in, with the camera sentence shown before any prompt */}
      {phase === "idle" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="card flex flex-col items-center gap-2 border-dashed py-8 text-center transition-colors hover:bg-surface-hover"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/15 text-brand">
                <Camera className="h-5 w-5" />
              </span>
              <span className="font-medium">Take a photo</span>
              <span className="text-xs text-muted">Reads the weight</span>
            </button>
            <button
              onClick={() => void startLive()}
              className="card flex flex-col items-center gap-2 border-dashed py-8 text-center transition-colors hover:bg-surface-hover"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/15 text-brand">
                <Video className="h-5 w-5" />
              </span>
              <span className="font-medium">Record a set</span>
              <span className="text-xs text-muted">Reads weight, reps, and the lift</span>
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            The camera is used to read the bar. A few still frames are sent to identify the lift,
            the plates, and your reps. No video is stored.
          </p>
        </>
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
            onLoadedMetadata={() => setVideoReady(true)}
            onPlaying={() => {
              setVideoReady(true);
              setNeedsTap(false);
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
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-danger/90 px-2.5 py-1 text-xs font-medium tabular-nums text-danger-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger-foreground" />
              recording {elapsed}s, do your set
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
            <button
              onClick={stopLive}
              className="rounded-lg bg-white/15 px-3 py-2 text-sm text-white"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
            {recording && countdown === 0 ? (
              <button
                onClick={finishRecording}
                className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-danger-foreground"
              >
                Stop and read
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={recording}
                className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground disabled:opacity-60"
              >
                Record a set
              </button>
            )}
            <span className="w-9" />
          </div>
        </div>
      )}

      {/* UPLOADING: real progress, so a slow connection never looks frozen */}
      {phase === "uploading" && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-brand" />
            <p className="font-medium">
              Sending {frameCount === 1 ? "the photo" : `${frameCount} frames`}
            </p>
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
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <ScanLine className="h-5 w-5 flex-shrink-0 text-brand" />
            <p className="font-medium">{labels[stage]}</p>
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
        <div className="card space-y-3">
          <p className="font-medium">{FAILURES[failure].title}</p>
          <p className="text-sm leading-relaxed text-muted">{FAILURES[failure].hint}</p>
          <div className="flex flex-wrap gap-2">
            {lastFramesRef.current.length > 0 && failure !== "few_frames" && (
              <button onClick={retry} className="btn-brand">
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            )}
            <button onClick={scanAgain} className="btn-ghost">
              <Camera className="h-4 w-4" />
              New capture
            </button>
            <Link href="/log" className="btn-ghost">
              Log by hand
            </Link>
          </div>
        </div>
      )}

      {/* RESULT: the money screen */}
      {phase === "result" && reading && review && (
        <div className="card space-y-4">
          {reading.detected ? (
            <>
              {editing === "exercise" ? (
                <select
                  autoFocus
                  className="input text-base"
                  value={exerciseId}
                  onChange={(e) => {
                    setExerciseId(e.target.value);
                    setEditing(null);
                  }}
                  onBlur={() => setEditing(null)}
                >
                  <option value="">Pick the lift</option>
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() => setEditing("exercise")}
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="text-2xl font-semibold leading-tight">
                    {exerciseName || "Pick the lift"}
                  </span>
                  <span className="micro flex-shrink-0">{review.exercise ? "check" : "change"}</span>
                </button>
              )}

              {/* Weight and reps, big enough to film */}
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl p-3 ${review.weight ? "bg-warning/10" : "bg-surface-2"}`}>
                  {/* One line, so this tile matches the reps tile's height. */}
                  <span className="micro">Total on bar ({units})</span>
                  {editing === "weight" ? (
                    <input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      className="input readout mt-1 text-center text-2xl"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      onBlur={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setEditing("weight")}
                      className="readout mt-1 block w-full text-left text-4xl font-semibold tabular-nums"
                    >
                      {weight || "—"}
                    </button>
                  )}
                </div>
                <div className={`rounded-xl p-3 ${review.reps ? "bg-warning/10" : "bg-surface-2"}`}>
                  <span className="micro">Reps</span>
                  {editing === "reps" ? (
                    <input
                      autoFocus
                      type="number"
                      inputMode="numeric"
                      className="input readout mt-1 text-center text-2xl"
                      value={reps}
                      onChange={(e) => setReps(e.target.value)}
                      onBlur={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setEditing("reps")}
                      className="readout mt-1 block w-full text-left text-4xl font-semibold tabular-nums"
                    >
                      {reps || "—"}
                    </button>
                  )}
                </div>
              </div>

              {/* What the model saw, and where it is unsure */}
              <p className="text-sm leading-relaxed text-muted">{reading.note}</p>
              {(review.weight || review.reps || review.exercise) && (
                <p className="text-sm leading-relaxed text-warning">
                  {review.weight && !weight
                    ? "The plates were not readable. Enter the weight."
                    : review.reps && !reps && frameCount === 1
                      ? "A photo cannot count reps. Enter them."
                      : "Tap any number to correct it before saving."}
                </p>
              )}
              {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
              {logError && <p className="text-sm text-danger">{logError}</p>}

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
                Scan again
              </button>
            </>
          ) : (
            <>
              <p className="font-medium">No loaded bar in frame</p>
              <p className="text-sm leading-relaxed text-muted">
                {hint ?? "Get the whole bar and plates in frame, filmed from the side."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={scanAgain} className="btn-brand">
                  <Camera className="h-4 w-4" />
                  Try another capture
                </button>
                <Link href="/log" className="btn-ghost">
                  Log by hand
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* LOGGED: the set, in context */}
      {phase === "logged" && result && (
        <div className="card space-y-4 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/15 text-success">
            {result.destination === "database" && result.isPR ? (
              <Trophy className="h-6 w-6" />
            ) : (
              <Check className="h-6 w-6" />
            )}
          </div>
          <div>
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
          <div className="flex gap-2">
            <button onClick={scanAgain} className="btn-brand flex-1">
              <ScanLine className="h-4 w-4" />
              Scan another
            </button>
            <Link
              href={result.destination === "draft" ? "/log" : "/dashboard"}
              className="btn-ghost flex-1 justify-center"
            >
              {result.destination === "draft" ? "Back to workout" : "Done"}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
