# Deload science & the readiness model

This document records the evidence base behind MyDeloadTracker's deload logic, how
each research finding maps to code, and the roadmap from today's heuristic model to
a machine-learning model once we have data.

## TL;DR — why a heuristic, not ML (yet)

We have **no labeled outcome data** (no record of "athlete deloaded → performance
rebounded" vs "didn't → stalled/got injured"). Training a model now would just
encode our own guesses with worse explainability. So the prototype uses a
**transparent weighted-factor model** (`src/lib/analytics/readiness.ts`) that:

- is fully explainable — we tell the athlete the exact factors and their weights,
- is cheap and instant — no inference infra, no funding required,
- is structured as a single scoring step so it can later be **swapped for, or
  blended with, a learned model** without touching the UI or data layer.

ML becomes worthwhile once we're collecting the outcome labels listed at the bottom.

## What the research says

The literature and coaching consensus converge on a handful of markers. Spacing:
most intermediates benefit from a deload every **4–6 weeks** of hard training;
advanced lifters often every **3–5 weeks**; a deload is typically a planned
**40–60% volume reduction** kept at **≤ RPE 6–7**, after which lifters frequently
**PR via supercompensation**.

Each marker is a factor with a **`maxStrength`** — its maximum pull on fatigue in
the noisy-OR aggregation (see "Scoring math"). These are evidence-weighted, not
normalized to sum to 1.

| Marker | Finding | Where it lives in code |
|---|---|---|
| **e1RM regression** | An estimated-1RM drop of **≥5%** while RPE is flat/rising is the *clearest* single fatigue marker — accumulated fatigue masks strength. | `factorRegression` (maxStrength 0.6) |
| **Stalled lifts** | Strength stalling **3+ weeks** at the same loads on main lifts. | `factorStall` (0.45) + deload signal (a) |
| **RPE creep** | A load that felt like RPE 7 now feels like RPE 9 (≈ **+2** at the same weight). | `factorRpeCreep` (0.4) + deload signal (b) |
| **Subjective wellness** | Poor sleep, high soreness, low motivation/energy (daily 1–5 check-ins) are well-supported under-recovery markers. | `factorWellness` (0.4) |
| **HRV depression** | A drop in heart-rate variability (e.g. RMSSD) vs the athlete's own baseline is among the most-supported *objective* fatigue/overreaching markers. | `factorHrv` (0.45) |
| **Resting-HR elevation** | A sustained rise in morning resting HR vs baseline signals autonomic under-recovery. | `factorRestingHr` (0.35) |
| **Frequency drop / missed sessions** | "Two bad workouts in a row" and falling session frequency signal under-recovery. | `factorFrequency` (0.34) + deload signal (c) |
| **Workload spike (ACWR)** | Acute:chronic workload ratio **> 1.5** is linked to elevated fatigue/injury risk (Gabbett). | `factorAcwr` (0.28) |
| **Time under load** | Sustained hard weeks without a lighter week accumulate fatigue. The deload spacing is now **experience-adjusted** (see below). | `factorTimeUnderLoad` (0.22) |

> Now captured: subjective wellness (sleep/soreness/motivation/energy) **and**
> objective recovery — HRV depression and resting-HR elevation vs the athlete's
> own rolling baseline. Both are entered manually in the check-in today and are
> built to auto-sync from wearables (Oura/Whoop/Apple Health) next.

## Experience-adjusted deload cadence (StrengthLevel standards)

A stall means different things at different levels: a novice usually just needs to
keep eating/sleeping/pushing, while an advanced lifter stalling is far likelier to
be carrying fatigue a deload fixes. The coaching consensus on spacing is itself
level-dependent — intermediates every **4–6 weeks**, advanced every **3–5**,
novices rarely needing a structured deload.

`src/lib/analytics/standards.ts` bands each main lift **Beginner → Elite** from the
ratio of estimated 1RM to bodyweight (per sex), in the spirit of
[StrengthLevel](https://strengthlevel.com)'s population tables, and rolls the lifts
up into one experience level. That level scales the `time_under_load` ramp via
`cadenceFor(level)` — e.g. novice fatigue from hard weeks starts counting at 7
weeks (maxing at 12), intermediate 5→9, advanced 4→7, elite 3→6. Bodyweight/sex are
optional: when unset the model falls back to **intermediate** defaults, so behavior
is unchanged for users who haven't entered their stats. The same banding feeds the
AI coach so its advice matches the athlete's level.

## How the two layers work together

1. **Binary deload trigger** (`detectDeload`, `deload.ts`) — the original spec: fires
   when **2+ of 3** signals are true. This is the actionable yes/no the dashboard
   alert and AI coach use. Kept deliberately simple and spec-faithful.
2. **Graded readiness score 0–100** (`computeReadiness`, `readiness.ts`) — a richer
   fatigue gauge layered on top, with bands: **≥75 fresh · 55–74 solid · 40–54
   caution · <40 deload**. It adds regression, ACWR, and time-under-load that the
   binary trigger doesn't model, and explains the top drivers.

Both feed the AI coach context (`context.ts`) so the chat advice matches the UI.

## Scoring math

Each factor produces a `strengthᵢ = maxStrengthᵢ · valueᵢ`, where `valueᵢ ∈ [0,1]`
(1 = max fatigue) is a clamped piecewise-linear ramp of its raw marker (e.g. e1RM
drop of 1%→0, 8%→1) and `maxStrengthᵢ` is that factor's evidence-weighted ceiling.
The factors combine with a **noisy-OR** rather than a weighted average:

```
fatigue = 1 − Π(1 − strengthᵢ)
score   = round(100 × (1 − fatigue))
```

Noisy-OR means independent risk factors **compound** — any two or three elevated
markers push fatigue high, instead of one absent marker dragging a fixed-weight
average back down. This keeps the gauge consistent with the 2-of-3 binary deload
trigger. The `maxStrength` ceilings are **not** normalized to sum to 1. Changing a
ceiling or ramp is a one-line edit — exactly the knobs we'd later let the data tune.

## Roadmap to ML (post-funding)

**Phase 1 — collect labels (now → first cohort).** Log, per athlete-week: all the
factor inputs above + outcomes — did they deload? did e1RM rebound in the following
2–3 weeks? injury/tweak reported? session RPEs. Add optional daily check-ins (sleep,
soreness, motivation 1–5) and, if available, wearable HRV/RHR.

**Phase 2 — calibrate the heuristic.** With a few hundred athlete-weeks, fit the
weights/ramps via logistic regression against "should have deloaded" labels. Still
fully interpretable; just data-driven instead of hand-set.

**Phase 3 — learned model.** With richer data, train a gradient-boosted or sequence
model (the weekly factors are a natural time series) to predict
`P(performance rebounds | deload now)` and recommend timing. Keep the heuristic as a
fallback and as an explainability baseline (SHAP-style per-factor attributions map
cleanly onto the factor cards we already show).

The data layer (`TrainingSet[]`) and the `computeReadiness(features) → score`
seam are already shaped so Phases 2–3 slot in behind the same UI.

## Sources

- [Gaining more from doing less? Effects of a one-week deload during supervised resistance training (NCBI/PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10809978/)
- [The Muscle PhD — Deloads](https://themusclephd.com/deloads-2/)
- [JEFIT — When to Deload in Strength Training: Science-Backed Guide](https://www.jefit.com/wp/exercise-tips/when-to-deload-in-strength-training-science-backed-guide/)
- [BONVEC Strength — 4 Signs You Might Need a Deload](https://bonvecstrength.com/2022/07/06/4-signs-you-might-need-a-deload/)
- [TTrening — Deload Week Guide: When, Why & How](https://ttrening.com/learn/articles/deload-weeks)
- [369MMAFIT — The Science of Deload Weeks (2026)](https://369mmafit.com/en/blog/deload-week-science-training-guide)

> Educational content, not medical advice.
