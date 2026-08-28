"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { capture } from "@/lib/track";
import { estimate1RM } from "@/lib/analytics/epley";
import { toKg } from "@/lib/units";
import { weightSemantics } from "@/lib/weight-semantics";
import { aliasesFor } from "@/lib/exercise-aliases";
import { saveWorkoutSession } from "@/lib/workout-save";
import { exerciseColor, exerciseGlyph } from "@/lib/exercise-visual";
import { RestTimer } from "@/components/rest-timer";
import { IconBadge } from "@/components/icon-badge";
import {
  completedSetCount,
  isWorkoutDraft,
  isDraftSetComplete,
  mergePlannedIntoDraft,
  plannedSessionFingerprint,
  reconcileDraftUnits,
  saveableCompletedSets,
  targetLabel,
  WORKOUT_DRAFT_KEY,
  type DraftSetOrigin,
  type PlannedExercise,
} from "@/lib/plan-session";
import { todayKey } from "@/lib/analytics/dates";
import type { Exercise, Units } from "@/lib/types";

interface SetEntry {
  reps: string;
  weight: string;
  rpe: string;
  origin?: DraftSetOrigin;
  completed?: boolean;
}

interface ExerciseEntry {
  key: string;
  exerciseId: string;
  sets: SetEntry[];
}

function emptySet(): SetEntry {
  return { reps: "", weight: "", rpe: "", origin: "manual", completed: false };
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
  planned,
}: {
  exercises: Exercise[];
  units: Units;
  sessionId?: string;
  initialDate?: string;
  initialNotes?: string;
  initialEntries?: InitialEntry[];
  /**
   * Today's planned session, already prefilled from the athlete's history by
   * plan-session.ts. When present the form starts populated, so logging is
   * confirming rather than searching and typing.
   */
  planned?: PlannedExercise[];
}) {
  const router = useRouter();
  const isEdit = Boolean(sessionId);
  // Local, not UTC. toISOString() is a UTC date, so an evening session
  // anywhere west of UTC was stamped with tomorrow. See dates.test.ts.
  const today = useMemo(() => todayKey(), []);
  const currentPlanFingerprint = useMemo(
    () => plannedSessionFingerprint(planned ?? [], units),
    [planned, units],
  );

  const [date, setDate] = useState(initialDate ?? today);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [draftPlanFingerprint, setDraftPlanFingerprint] = useState(currentPlanFingerprint);
  const [entries, setEntries] = useState<ExerciseEntry[]>(() => {
    if (initialEntries?.length) {
      return initialEntries.map((e, i) => ({
        key: `${e.exerciseId}-init-${i}`,
        exerciseId: e.exerciseId,
        sets: e.sets.map((s) => ({
          reps: String(s.reps),
          weight: String(s.weight),
          rpe: s.rpe == null ? "" : String(s.rpe),
          origin: "manual" as const,
          completed: true,
        })),
      }));
    }
    // Start from today's plan. A restored draft overwrites this in the effect
    // below, because work already in progress beats a fresh prescription.
    return (planned ?? []).map((p, i) => ({
      key: `${p.exerciseId}-plan-${i}`,
      exerciseId: p.exerciseId,
      sets: p.sets.map((s) => ({ ...s })),
    }));
  });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Bumped each time a set is marked done, so the rest timer auto-starts.
  const [restSignal, setRestSignal] = useState(0);
  // Which exercise cards are expanded. A workout reads as a tappable list of
  // exercises; the first opens so logging starts right away, and a newly added
  // exercise opens itself.
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(entries[0] ? [entries[0].key] : []),
  );
  // Drag-to-reorder: which exercise is being dragged, and the live element rects
  // so a drag over another card moves the exercise there.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [prs, setPrs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Only meaningful when a plan prefilled the session; without one the search
  // box is the primary control and stays open.
  const [searchOpen, setSearchOpen] = useState(false);

  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  // Targets survive a draft restore because they come from the plan on every
  // render, not from the stored draft.
  const plannedById = useMemo(
    () => new Map((planned ?? []).map((p) => [p.exerciseId, p])),
    [planned],
  );

  // Restore an in-progress workout (new sessions only) so switching tabs or
  // closing the app never loses what you were entering.
  useEffect(() => {
    if (isEdit) {
      setLoaded(true);
      return;
    }
    try {
      const raw = localStorage.getItem(WORKOUT_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (isWorkoutDraft(d) && d.entries.length) {
          const reconciled = reconcileDraftUnits(d, units);
          // Merge rather than replace. See mergePlannedIntoDraft for why this
          // only ever adds, and what it deliberately refuses to remove.
          setEntries(
            mergePlannedIntoDraft(
              reconciled.entries,
              planned ?? [],
              reconciled.date,
              today,
            ),
          );
          setDate(reconciled.date);
          setNotes(reconciled.notes);
          // A legacy draft has no baseline. Adopt the current prescription
          // rather than warning about a change we cannot prove happened.
          setDraftPlanFingerprint(reconciled.planFingerprint ?? currentPlanFingerprint);
        }
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
      if (entries.length)
        localStorage.setItem(
          WORKOUT_DRAFT_KEY,
          JSON.stringify({
            date,
            notes,
            entries,
            units,
            planFingerprint: draftPlanFingerprint,
          }),
        );
      else localStorage.removeItem(WORKOUT_DRAFT_KEY);
    } catch {
      /* storage might be unavailable; the workout still works in-memory */
    }
  }, [entries, date, notes, loaded, isEdit, units, draftPlanFingerprint]);

  function discardDraft() {
    setEntries([]);
    setNotes("");
    setDraftPlanFingerprint(currentPlanFingerprint);
    try {
      localStorage.removeItem(WORKOUT_DRAFT_KEY);
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

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Drag-to-reorder from the grip handle: the dragged exercise moves to whichever
  // card the finger is over, so the list reorders live. Reordering the entries
  // reorders how the workout is shown and saved.
  function reorderStart(key: string, e: React.PointerEvent) {
    e.preventDefault();
    setDragKey(key);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function reorderMove(e: React.PointerEvent) {
    if (!dragKey) return;
    const y = e.clientY;
    let target: string | null = null;
    for (const [k, el] of cardRefs.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        target = k;
        break;
      }
    }
    if (target && target !== dragKey) {
      setEntries((prev) => {
        const from = prev.findIndex((en) => en.key === dragKey);
        const to = prev.findIndex((en) => en.key === target);
        if (from < 0 || to < 0) return prev;
        const next = [...prev];
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
      });
    }
  }
  function reorderEnd() {
    setDragKey(null);
  }

  function addExerciseById(id: string) {
    const key = `${id}-${Date.now()}`;
    setEntries((prev) => [...prev, { key, exerciseId: id, sets: [emptySet()] }]);
    setOpenKeys((prev) => new Set(prev).add(key));
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
        return {
          ...e,
          sets: [...e.sets, { ...last, origin: "manual", completed: false }],
        };
      }),
    );
  }

  function removeSet(key: string, idx: number) {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, sets: e.sets.filter((_, i) => i !== idx) } : e)),
    );
  }

  function updateSet(key: string, idx: number, field: "reps" | "weight" | "rpe", value: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.key === key
          ? {
              ...e,
              sets: e.sets.map((s, i) =>
                i === idx
                  ? { ...s, [field]: value, origin: "manual", completed: true }
                  : s,
              ),
            }
          : e,
      ),
    );
  }

  function toggleSetCompletion(key: string, idx: number) {
    // Read the current state to tell which direction the toggle goes, so the
    // rest timer starts only when a set becomes done, not when it is un-done.
    const target = entries.find((entry) => entry.key === key)?.sets[idx];
    const becomingDone = target ? !isDraftSetComplete(target) : false;
    setEntries((prev) =>
      prev.map((entry) =>
        entry.key === key
          ? {
              ...entry,
              sets: entry.sets.map((set, i) =>
                i === idx ? { ...set, completed: !isDraftSetComplete(set) } : set,
              ),
            }
          : entry,
      ),
    );
    if (becomingDone) setRestSignal((n) => n + 1);
  }

  async function save() {
    setError(null);

    const rows = entries.flatMap((entry) => {
      // Bodyweight movements accept a blank/zero weight (added weight = 0).
      const sem = weightSemantics(exerciseById.get(entry.exerciseId)?.equipment);
      return saveableCompletedSets(entry.sets, sem.allowZero).map((s, i) => ({
        exercise_id: entry.exerciseId,
        set_number: i + 1,
        reps: Number(s.reps),
        // Stored canonically in kg; the athlete typed it in their unit.
        weight: toKg(Number(s.weight || 0), units),
        rpe: s.rpe === "" ? null : Number(s.rpe),
      }));
    });

    const markedCount = entries.reduce(
      (total, entry) => total + completedSetCount(entry.sets),
      0,
    );
    if (rows.length === 0 || rows.length !== markedCount) {
      setError("Check reps, weight, and RPE for every completed set before saving.");
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
      // One atomic RPC for both create and edit (migration 0019). No split
      // writes: a failed set insert can no longer leave an empty session, and an
      // edit can no longer delete the old sets unless the replacement lands.
      const targetSessionId = await saveWorkoutSession(supabase, {
        sessionId: isEdit ? sessionId : undefined,
        performedAt,
        notes: notes || null,
        sets: rows,
      });

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

      capture("workout_logged", {
        sets: rows.length,
        exercises: new Set(rows.map((row) => row.exercise_id)).size,
        edit: isEdit,
        prs: prNames.length,
      });
      try {
        localStorage.removeItem(WORKOUT_DRAFT_KEY);
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

  const hasPlan = (planned?.length ?? 0) > 0;
  const planChanged = !isEdit && loaded && draftPlanFingerprint !== currentPlanFingerprint;
  const completedCount = entries.reduce((total, entry) => total + completedSetCount(entry.sets), 0);
  const totalSetCount = entries.reduce((total, entry) => total + entry.sets.length, 0);
  const saveableCount = entries.reduce((total, entry) => {
    const sem = weightSemantics(exerciseById.get(entry.exerciseId)?.equipment);
    return total + saveableCompletedSets(entry.sets, sem.allowZero).length;
  }, 0);
  const invalidCompletedCount = completedCount - saveableCount;

  return (
    <div className="space-y-4">
      {/* With a plan the workout is already built, so search collapses to a slim
          control and the exercises get the top of the screen. Measured: the open
          search plus the RPE explainer pushed the first input to y=776 on a
          393x852 phone, which is behind the bottom nav. */}
      {hasPlan && !searchOpen && (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted transition-colors hover:border-brand/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Add an exercise
        </button>
      )}

      {/* Search, pinned at the top so the keyboard never covers it. */}
      <div className={`card ${hasPlan && !searchOpen ? "hidden" : ""}`}>
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
                  className="tap flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-hover"
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

      <RestTimer startSignal={restSignal} />

      {planChanged && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="min-w-0 text-xs leading-snug">
            <span className="font-semibold">Your plan changed while this workout was open.</span>{" "}
            Your set entries stayed as they were so completed work is not lost. Review them
            before saving.
          </p>
        </div>
      )}

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
          {totalSetCount > 0 && (
            <div className="mt-2 flex items-center gap-2.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
                  style={{ width: `${(completedCount / totalSetCount) * 100}%` }}
                />
              </div>
              <span
                className={`readout flex-shrink-0 text-[11px] tabular-nums ${
                  completedCount === totalSetCount ? "text-success" : "text-muted"
                }`}
              >
                {completedCount}/{totalSetCount} sets
              </span>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Tap a set number when you finish it. Editing a row marks it done.
          </p>
          {!hasPlan && (
            <p className="mt-1 text-[11px] leading-snug text-muted">
              RPE is optional effort, 1 to 10. Think reps left in the tank: RPE 8 means you had 2
              more in you, RPE 10 means none. Skip it if you are not sure.
            </p>
          )}
        </div>
      )}

      {entries.map((entry) => {
        const ex = exerciseById.get(entry.exerciseId);
        const sem = weightSemantics(ex?.equipment);
        const plan = plannedById.get(entry.exerciseId);
        const entryCompleted = completedSetCount(entry.sets);
        const isOpen = openKeys.has(entry.key);
        // The first set not yet marked done is "up next", highlighted so the eye
        // lands on what to do rather than on the sets already logged. -1 (all
        // done) highlights nothing.
        const nextSetIdx = entry.sets.findIndex((st) => !isDraftSetComplete(st));
        return (
          <div
            key={entry.key}
            ref={(el) => {
              if (el) cardRefs.current.set(entry.key, el);
              else cardRefs.current.delete(entry.key);
            }}
            className={`card ${dragKey === entry.key ? "border-brand shadow-lg" : ""}`}
          >
            {/* Header: a grip to drag-reorder, a tappable summary that expands to
                the sets, and a remove button. */}
            <div className="flex items-center gap-2">
              {entries.length > 1 && (
                <button
                  type="button"
                  onPointerDown={(e) => reorderStart(entry.key, e)}
                  onPointerMove={reorderMove}
                  onPointerUp={reorderEnd}
                  onPointerCancel={reorderEnd}
                  aria-label="Drag to reorder exercise"
                  className="grid h-10 w-6 flex-shrink-0 touch-none place-items-center rounded-lg text-faint hover:text-muted"
                >
                  <GripVertical className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleOpen(entry.key)}
                aria-expanded={isOpen}
                className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <IconBadge icon={exerciseGlyph(ex ?? {})} color={exerciseColor(ex?.muscle_group)} size="md" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold leading-tight">{ex?.name}</h3>
                  <p className="truncate text-xs text-muted">
                    {ex?.muscle_group}
                    {ex?.equipment && ` · ${ex.equipment}`}
                    {ex?.is_major && <span className="text-brand"> · major</span>}
                    <span> · {entryCompleted}/{entry.sets.length} done</span>
                  </p>
                </div>
                <ChevronDown
                  className={`h-5 w-5 flex-shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {isOpen && (
              <div className="mt-4">
            {/* The plan's prescription, plus why the weight is prefilled the way
                it is. Only rendered for a planned lift. */}
            {plan && (
              <div className="mb-3 rounded-lg border border-border bg-surface-2 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="micro">Target</span>
                  <span className="readout text-sm font-semibold">{targetLabel(plan.target)}</span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  {plan.weightBasis === "no_history"
                    ? "First time logging this one. Enter the weight you use."
                    : (plan.note ?? "Weight carried over from your last session.")}
                </p>
                {/* The plan and the athlete's measured performance disagree.
                    Stated rather than silently resolved, and styled as a
                    warning because raising reps on a near-maximal lift is the
                    case that matters. */}
                {plan.conflict && (
                  <p
                    className={`mt-1.5 text-[11px] leading-snug ${
                      plan.repsAdjusted === "raised_to_floor" ? "text-warning" : "text-muted"
                    }`}
                  >
                    {plan.conflict}
                  </p>
                )}
              </div>
            )}

            {/* What "weight" means for this movement — one dumbbell, total bar, added, etc. */}
            <p className="mb-3 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[11px] leading-snug text-brand">
              {sem.hint}
            </p>

            <div className="space-y-2">
              <div className="grid grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem] items-center gap-2">
                <span className="micro text-center">Done</span>
                <span className="micro">Reps</span>
                <span className="micro">Weight ({units})</span>
                <span className="micro">RPE</span>
                <span />
              </div>
              {entry.sets.map((s, i) => {
                const complete = isDraftSetComplete(s);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem] items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSetCompletion(entry.key, i)}
                      aria-pressed={complete}
                      aria-label={`Set ${i + 1}, ${complete ? "completed" : "not completed"}`}
                      className={`tap readout grid h-9 place-items-center rounded-lg text-sm font-medium transition-colors ${
                        complete
                          ? "bg-success/15 text-success"
                          : i === nextSetIdx
                            ? "bg-brand/15 text-brand ring-1 ring-inset ring-brand/40"
                            : "bg-surface-2 text-muted hover:bg-surface-hover"
                      }`}
                    >
                      {complete ? <Check className="h-4 w-4" /> : i + 1}
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      className="input readout px-2 text-center"
                      placeholder="5"
                      value={s.reps}
                      onChange={(e) => updateSet(entry.key, i, "reps", e.target.value)}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      className="input readout px-2 text-center"
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
                      className="input readout px-2 text-center"
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
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => addSet(entry.key)} className="btn-ghost flex-1 text-sm">
                <Plus className="h-4 w-4" /> Add set
              </button>
              <button
                onClick={() => removeExercise(entry.key)}
                className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-border text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                aria-label="Remove exercise"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
              </div>
            )}
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
            <Trophy className="h-4 w-4" /> New PR: {prs.join(", ")}
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> Saved
          </p>
        ))}

      {/* Sticky action bar: on a phone the Save stays in the thumb's reach just
          above the bottom nav instead of hiding at the end of a long form, so
          logging never needs a scroll to the bottom. On desktop it is a normal
          inline button (no bottom nav there). The offset clears the nav height
          plus the safe-area inset. */}
      <div
        className="sticky z-10 mt-3 rounded-xl border border-border bg-surface/85 p-2 shadow-lg backdrop-blur md:static md:mt-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none"
        style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={save}
          disabled={saving || saved || saveableCount === 0 || invalidCompletedCount > 0}
          className="btn-brand w-full py-3"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit
            ? "Save changes"
            : invalidCompletedCount > 0
              ? `Fix ${invalidCompletedCount} completed ${invalidCompletedCount === 1 ? "set" : "sets"}`
              : saveableCount > 0
              ? `Save ${saveableCount} ${saveableCount === 1 ? "set" : "sets"}`
              : completedCount > 0
                ? "Fill the completed set to save"
                : "Complete a set to save"}
        </button>
      </div>
    </div>
  );
}
