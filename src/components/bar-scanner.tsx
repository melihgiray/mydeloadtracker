"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, ScanLine, Sparkles, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { capture } from "@/lib/track";
import { toKg } from "@/lib/units";
import type { Exercise, Units } from "@/lib/types";

interface Reading {
  detected: boolean;
  exercise?: string;
  equipment?: string;
  total_weight_kg?: number | null;
  per_side_plates_kg?: number[];
  reps?: number | null;
  confidence: "high" | "medium" | "low";
  note: string;
}

const LB = 2.20462;
const round5 = (n: number) => Math.round(n / 5) * 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CONF: Record<string, string> = { high: "text-success", medium: "text-warning", low: "text-danger" };

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

export function BarScanner({ exercises, units }: { exercises: Exercise[]; units: Units }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufRef = useRef<string[]>([]);
  const tickRef = useRef(0);
  const everyNthRef = useRef(1);
  const intervalRef = useRef<number | null>(null);

  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("5");
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  useEffect(() => () => stopLive(), []); // cleanup camera on unmount

  function stopLive() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
    setRecording(false);
    setCountdown(0);
    setElapsed(0);
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

  function applyReading(r: Reading) {
    setReading(r);
    if (r.detected) {
      setExerciseId(matchExercise(r.exercise));
      const kg = r.total_weight_kg ?? 0;
      setWeight(kg > 0 ? String(units === "lb" ? round5(kg * LB) : kg) : "");
      setReps(r.reps && r.reps > 0 ? String(r.reps) : "5");
    }
  }

  async function analyze(images: string[]) {
    setError(null);
    setReading(null);
    setLogged(false);
    setAnalyzing(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed.");
      const r = json.reading as Reading;
      capture("bar_scanned", { detected: r.detected, confidence: r.confidence, frames: images.length });
      applyReading(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function onPhoto(file: File) {
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);
      await analyze([dataUrl]);
    } catch {
      setError("Couldn't read that photo. Try again.");
    }
  }

  async function startLive() {
    setError(null);
    setReading(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setLive(true);
      // wait a tick for the <video> to mount, then attach
      await sleep(0);
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
    } catch {
      setError("Couldn't open the camera. Take a photo instead, or check camera permissions.");
      stopLive();
    }
  }

  // Record an arbitrary-length set. We sample frames continuously but keep a
  // BOUNDED, evenly-spaced buffer (≤16) that always spans the whole recording —
  // so a 5-second single and a 60-second 20-rep set both send a fixed, affordable
  // number of frames covering the entire movement. (This is the phone version of
  // the on-device "process the stream, not a fixed clip" model — see below.)
  async function startRecording() {
    const v = videoRef.current;
    if (!v) return;
    setError(null);
    setRecording(true);
    for (let n = 3; n >= 1; n--) {
      setCountdown(n);
      await sleep(650);
    }
    setCountdown(0);
    bufRef.current = [];
    tickRef.current = 0;
    everyNthRef.current = 1;
    const start = Date.now();
    intervalRef.current = window.setInterval(() => {
      const secs = (Date.now() - start) / 1000;
      setElapsed(Math.floor(secs));
      if (secs > 90) return finishRecording(); // hard safety cap
      tickRef.current += 1;
      if (tickRef.current % everyNthRef.current !== 0) return;
      const f = grabFrame(v);
      if (f) bufRef.current.push(f);
      if (bufRef.current.length >= 16) {
        // halve to every-other frame + halve the sample rate → stays bounded and
        // evenly spaced across however long the set runs.
        bufRef.current = bufRef.current.filter((_, i) => i % 2 === 0);
        everyNthRef.current *= 2;
      }
    }, 500);
  }

  function finishRecording() {
    const frames = [...bufRef.current];
    stopLive(); // clears the interval + stops the camera
    setPreview(frames[frames.length - 1] ?? null);
    if (frames.length >= 2) void analyze(frames);
    else setError("Didn't catch enough of the set. Try again in better light.");
  }

  async function logSet() {
    if (!exerciseId || !(Number(weight) > 0) || !(Number(reps) > 0)) {
      setError("Pick the exercise and enter weight × reps.");
      return;
    }
    setLogging(true);
    setError(null);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You're not signed in.");
      const { data: session, error: sErr } = await supabase
        .from("workout_sessions")
        .insert({ user_id: user.id, performed_at: new Date().toISOString(), notes: "Scanned" })
        .select("id")
        .single();
      if (sErr || !session) throw new Error(sErr?.message ?? "Could not log.");
      const { error: setErr } = await supabase.from("workout_sets").insert({
        session_id: session.id,
        exercise_id: exerciseId,
        user_id: user.id,
        set_number: 1,
        reps: Number(reps),
        weight: toKg(Number(weight), units),
        rpe: null,
      });
      if (setErr) throw new Error(setErr.message);
      capture("workout_logged", { sets: 1, exercises: 1, edit: false, source: "scan" });
      setLogged(true);
      setTimeout(() => router.push("/dashboard"), 1200);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log.");
      setLogging(false);
    }
  }

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
          if (f) onPhoto(f);
          e.target.value = "";
        }}
      />

      {/* LIVE CAMERA */}
      {live && (
        <div className="card relative overflow-hidden p-0">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="aspect-[3/4] w-full bg-black object-cover sm:aspect-video"
          />
          {countdown > 0 && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 text-6xl font-bold text-white">
              {countdown}
            </div>
          )}
          {recording && countdown === 0 && (
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-danger/90 px-2.5 py-1 text-xs font-medium text-white tabular-nums">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> recording {elapsed}s, do your set
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
            <button onClick={stopLive} className="rounded-lg bg-white/15 px-3 py-2 text-sm text-white" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
            {recording && countdown === 0 ? (
              <button
                onClick={finishRecording}
                className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white"
              >
                Stop &amp; analyze
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

      {/* CHOOSE (photo or video) */}
      {!live && (
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
            onClick={startLive}
            className="card flex flex-col items-center gap-2 border-dashed py-8 text-center transition-colors hover:bg-surface-hover"
          >
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/15 text-brand">
              <Video className="h-5 w-5" />
            </span>
            <span className="font-medium">Record a rep</span>
            <span className="text-xs text-muted">Reads weight + reps + the lift</span>
          </button>
        </div>
      )}

      {preview && !live && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Captured" className="mx-auto max-h-48 rounded-xl object-contain" />
      )}

      {analyzing && (
        <div className="card flex items-center gap-3 text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
          <span className="flex items-center gap-1.5">
            <ScanLine className="h-4 w-4 text-brand" /> Reading the bar…
          </span>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {reading && !analyzing && (
        <div className="card space-y-4">
          {reading.detected ? (
            <>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand" />
                <div>
                  <p className="font-medium">{reading.note}</p>
                  <p className={`text-xs ${CONF[reading.confidence]}`}>
                    {reading.confidence} confidence, check it before logging
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <label className="label">Exercise</label>
                  <select className="input" value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
                    <option value="">Pick exercise…</option>
                    {exercises.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Weight ({units})</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input w-24"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Reps</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="input w-20"
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                  />
                </div>
              </div>

              {logged ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <Check className="h-4 w-4" /> Logged! Taking you to your dashboard…
                </p>
              ) : (
                <button onClick={logSet} disabled={logging} className="btn-brand w-full">
                  {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Log this set
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              {reading.note || "Couldn't spot a loaded bar. Try a clearer shot of the plates."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
