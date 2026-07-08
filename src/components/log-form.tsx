"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, Trash2, Trophy, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { capture } from "@/lib/track";
import { estimate1RM } from "@/lib/analytics/epley";
import { toKg } from "@/lib/units";
import { weightSemantics } from "@/lib/weight-semantics";
import { aliasesFor } from "@/lib/exercise-aliases";
import { exerciseColor, exerciseGlyph } from "@/lib/exercise-visual";
import { RestTimer } from "@/components/rest-timer";
import { IconBadge } from "@/components/icon-badge";
import type { Exercise, Units } from "@/lib/types";

const DRAFT_KEY = "mdt_workout_draft_v1";

interface SetEntry {
  reps: string;
  weight: string;
  rpe: string;
}

interface ExerciseEntry {
  key: string;
  exerciseId: string;
  sets: SetEntry[];
}

function emptySet(): SetEntry {
  return { reps: "", weight: "", rpe: "" };
}

export interface InitialEntry {
  exerciseId: string;
  sets: { reps: number; weight: number; rpe: number | null }[];
}

export function LogForm({
  exercises,
  units,
  sessionId,
  initialDate,
  initialNotes,
  initialEntries,
}: {
  exercises: Exercise[];
  units: Units;
  sessionId?: string;
  initialDate?: string;
  initialNotes?: string;
  initialEntries?: InitialEntry[];
}) {
  const router = useRouter();
  const isEdit = Boolean(sessionId);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [date, setDate] = useState(initialDate ?? today);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [entries, setEntries] = useState<ExerciseEntry[]>(() =>
    (initialEntries ?? []).map((e, i) => ({
      key: `${e.exerciseId}-init-${i}`,
      exerciseId: e.exerciseId,
      sets: e.sets.map((s) => ({
        reps: String(s.reps),
        weight: String(s.weight),
        rpe: s.rpe == null ? "" : String(s.rpe),
      })),
    })),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [prs, setPrs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  // Restore an in-progress workout (new sessions only) so switching tabs or
  // closing the app never loses what you were entering.
  useEffect(() => {
    if (isEdit) {
      setLoaded(true);
      return;
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.entries) && d.entries.length) setEntries(d.entries);
        if (typeof d.date === "string") setDate(d.date);
        if (typeof d.notes === "string") setNotes(d.notes);
      }
    } catch {
      /* ignore a corrupt draft */
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft on every change.
  useEffect(() => {
    if (isEdit || !loaded) return;
    try {
      if (entries.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ date, notes, entries }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage might be unavailable; the workout still works in-memory */
    }
  }, [entries, date, notes, loaded, isEdit]);

  function discardDraft() {
    setEntries([]);
    setNotes("");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* no-op */
    }
  }

  // Typeahead: closest matches first, capped. Empty query shows nothing, so the
  // field does not dump the whole library the moment you tap it. Matching runs
  // over the canonical name AND the slang lifters actually type ("skull
  // crusher", "rdl", "pec deck"), via the alias map.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return exercises
      .map((ex) => {
        let score = -1;
        for (const term of [ex.name, ...aliasesFor(ex.name)]) {
          const t = term.toLowerCase();
          if (t === q) score = Math.max(score, 100);
          else if (t.startsWith(q)) score = Math.max(score, 80);
          else if (t.includes(q)) score = Math.max(score, 60);
        }
        if (score < 0) {
          if (ex.muscle_group.toLowerCase().includes(q)) score = 40;
          else if ((ex.equipment ?? "").toLowerCase().includes(q)) score = 30;
        }
        return { ex, score };
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score || a.ex.name.length - b.ex.name.length)
      .slice(0, 12)
      .map((s) => s.ex);
  }, [exercises, query]);

  function addExerciseById(id: string) {
    setEntries((prev) => [...prev, { key: `${id}-${Date.now()}`, exerciseId: id, sets: [emptySet()] }]);
    setQuery("");
  }

  function removeExercise(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  function addSet(key: string) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.key !== key) return e;
        const last = e.sets[e.sets.length - 1] ?? emptySet();
        return { ...e, sets: [...e.sets, { ...last }] };
      }),
    );
  }

  function removeSet(key: string, idx: number) {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, sets: e.sets.filter((_, i) => i !== idx) } : e)),
    );
  }

  function updateSet(key: string, idx: number, field: keyof SetEntry, value: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.key === key ? { ...e, sets: e.sets.map((s, i) => (i === idx ? { ...s, [field]: value } : s)) } : e,
      ),
    );
  }

  async function save() {
    setError(null);

    const rows = entries.flatMap((entry) => {
      // Bodyweight movements accept a blank/zero weight (added weight = 0).
      const sem = weightSemantics(exerciseById.get(entry.exerciseId)?.equipment);
      return entry.sets
        .filter((s) => s.reps !== "" && (s.weight !== "" || sem.allowZero))
        .map((s, i) => ({
          exercise_id: entry.exerciseId,
          set_number: i + 1,
          reps: Number(s.reps),
          // Stored canonically in kg; the athlete typed it in their unit.
          weight: toKg(Number(s.weight || 0), units),
          rpe: s.rpe === "" ? null : Number(s.rpe),
        }));
    });

    if (rows.length === 0) {
      setError("Add at least one set with reps and weight.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You are not signed in.");

      const performedAt = new Date(`${date}T12:00:00`).toISOString();
      let targetSessionId = sessionId;

      if (isEdit && sessionId) {
        const { error: uErr } = await supabase
          .from("workout_sessions")
          .update({ performed_at: performedAt, notes: notes || null })
          .eq("id", sessionId);
        if (uErr) throw new Error(uErr.message);

        const { error: delErr } = await supabase.from("workout_sets").delete().eq("session_id", sessionId);
        if (delErr) throw new Error(delErr.message);
      } else {
        const { data: session, error: sErr } = await supabase
          .from("workout_sessions")
          .insert({ user_id: user.id, performed_at: performedAt, notes: notes || null })
          .select("id")
          .single();
        if (sErr || !session) throw new Error(sErr?.message ?? "Could not create session.");
        targetSessionId = session.id;
      }

      const { error: setErr } = await supabase
        .from("workout_sets")
        .insert(rows.map((r) => ({ ...r, session_id: targetSessionId, user_id: user.id })));
      if (setErr) throw new Error(setErr.message);

      let prNames: string[] = [];
      if (!isEdit) {
        const newBest = new Map<string, number>();
        for (const r of rows) {
          const e = estimate1RM(r.weight, r.reps);
          if (e > (newBest.get(r.exercise_id) ?? 0)) newBest.set(r.exercise_id, e);
        }
        const { data: prior } = await supabase
          .from("workout_sets")
          .select("exercise_id, reps, weight")
          .eq("user_id", user.id)
          .in("exercise_id", [...newBest.keys()])
          .neq("session_id", targetSessionId);
        const priorBest = new Map<string, number>();
        for (const p of prior ?? []) {
          const e = estimate1RM(Number(p.weight), p.reps);
          if (e > (priorBest.get(p.exercise_id) ?? 0)) priorBest.set(p.exercise_id, e);
        }
        for (const [exId, best] of newBest) {
          const prev = priorBest.get(exId);
          if (prev != null && best > prev + 0.01) prNames.push(exerciseById.get(exId)?.name ?? "a lift");
        }
        setPrs(prNames);
      }

      capture("workout_logged", { sets: rows.length, exercises: entries.length, edit: isEdit, prs: prNames.length });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* no-op */
      }
      setSaved(true);
      setTimeout(() => router.push(isEdit ? "/history" : "/dashboard"), prNames.length ? 2000 : 700);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workout.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search, pinned at the top so the keyboard never covers it. */}
      <div className="card">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-10 pr-10"
            inputMode="search"
            autoComplete="off"
            placeholder={`Search ${exercises.length} exercises`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                addExerciseById(results[0].id);
              }
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {query.trim() && (
          <div className="mt-2 max-h-[44vh] overflow-auto rounded-xl border border-border scroll-thin">
            {results.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">
                Nothing matches &ldquo;{query}&rdquo;. Try a muscle or a piece of equipment.
              </p>
            ) : (
              results.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => addExerciseById(ex.id)}
                  className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-hover"
                >
                  <IconBadge icon={exerciseGlyph(ex)} color={exerciseColor(ex.muscle_group)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {ex.name}
                      {ex.is_major && <span className="text-[10px] font-semibold text-brand">MAJOR</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {ex.muscle_group}
                      {ex.equipment && ` · ${ex.equipment}`}
                    </span>
                  </span>
                  <Plus className="h-4 w-4 flex-shrink-0 text-faint" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <RestTimer />

      {/* Session builder: one ongoing workout, saved as a draft as you go. */}
      {entries.length > 0 && (
        <div className="px-1 pt-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              This workout · {entries.length} {entries.length === 1 ? "exercise" : "exercises"}
            </p>
            <button
              onClick={discardDraft}
              className="text-xs text-muted transition-colors hover:text-danger"
            >
              Discard
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            RPE is optional effort, 1 to 10. Think reps left in the tank: RPE 8 means you had 2
            more in you, RPE 10 means none. Skip it if you are not sure.
          </p>
        </div>
      )}

      {entries.map((entry) => {
        const ex = exerciseById.get(entry.exerciseId);
        const sem = weightSemantics(ex?.equipment);
        return (
          <div key={entry.key} className="card">
            <div className="mb-4 flex items-center gap-3">
              <IconBadge icon={exerciseGlyph(ex ?? {})} color={exerciseColor(ex?.muscle_group)} size="md" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-tight">{ex?.name}</h3>
                <p className="truncate text-xs text-muted">
                  {ex?.muscle_group}
                  {ex?.equipment && ` · ${ex.equipment}`}
                  {ex?.is_major && <span className="text-brand"> · major lift</span>}
                </p>
              </div>
              <button
                onClick={() => removeExercise(entry.key)}
                className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                aria-label="Remove exercise"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* What "weight" means for this movement — one dumbbell, total bar, added, etc. */}
            <p className="mb-3 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[11px] leading-snug text-brand">
              {sem.hint}
            </p>

            <div className="space-y-2">
              <div className="grid grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem] items-center gap-2">
                <span className="micro text-center">Set</span>
                <span className="micro">Reps</span>
                <span className="micro">Weight ({units})</span>
                <span className="micro">RPE</span>
                <span />
              </div>
              {entry.sets.map((s, i) => (
                <div key={i} className="grid grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem] items-center gap-2">
                  <span className="readout grid h-9 place-items-center rounded-lg bg-surface-2 text-sm font-medium text-muted">
                    {i + 1}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="input readout text-center"
                    placeholder="5"
                    value={s.reps}
                    onChange={(e) => updateSet(entry.key, i, "reps", e.target.value)}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    className="input readout text-center"
                    placeholder={sem.allowZero ? "0" : "100"}
                    value={s.weight}
                    onChange={(e) => updateSet(entry.key, i, "weight", e.target.value)}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="1"
                    max="10"
                    className="input readout text-center"
                    placeholder="8"
                    value={s.rpe}
                    onChange={(e) => updateSet(entry.key, i, "rpe", e.target.value)}
                  />
                  <button
                    onClick={() => removeSet(entry.key, i)}
                    className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    aria-label="Remove set"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button onClick={() => addSet(entry.key)} className="btn-ghost mt-3 w-full text-sm">
              <Plus className="h-4 w-4" /> Add set
            </button>
          </div>
        );
      })}

      {/* Date + notes, secondary, kept out of the way at the bottom. */}
      <div className="card">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Session date</label>
            <input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Felt strong, bumped squat"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {saved &&
        (prs.length > 0 ? (
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-warning">
            <Trophy className="h-4 w-4" /> New PR: {prs.join(", ")}!
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> Saved
          </p>
        ))}

      <button
        onClick={save}
        disabled={saving || saved || entries.length === 0}
        className="btn-brand w-full py-3"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {isEdit ? "Save changes" : "Save workout"}
      </button>
    </div>
  );
}
