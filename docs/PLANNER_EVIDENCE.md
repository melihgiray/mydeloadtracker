# What the planner's rules are actually based on

Date: 2026-07-30. Research pass run by the founder via Cowork,
`exercise_order_and_weak_point_prioritisation`. This file records only the
claims that changed code, with the citation and the grade, so nobody has to
take a prompt rule on faith.

The headline is uncomfortable and worth stating first: **of the five questions
asked, the three with real evidence all came back negative, and the two the
weak-point feature actually depends on have essentially no direct evidence.**
Order, pre-exhaustion and frequency are not hypertrophy levers. Volume is.

## The finding that changed shipped behaviour

**Pre-exhaustion does not work, and the planner was generating it.**

Rule 9 used to say a lagging muscle's isolation work should open the day,
before the compounds that fatigue it. The first plan generated under that rule
opened Upper A with Tricep Pushdown then Bench Press, and Upper B with Dumbbell
Curl then Deadlift and Lat Pulldown. Isolation immediately before a compound
sharing the same muscle IS pre-exhaustion.

Four independent lines converge against it:

| Finding | Source | Population |
|---------|--------|------------|
| No increase in target-muscle EMG in the following compound | Fujita 2022, PMC9465739 | 20 untrained |
| Slightly LESS hypertrophy than traditional order, equal strength | Hermann 2026, IJES 19(1):1008 | **48 trained, age 22.5, the best match to this app** |
| No strength or body-composition advantage over 12 weeks | Fisher 2014, doi:10.1139/apnm-2014-0162 | 39 trained |
| Matched traditional training, on less volume | Trindade 2019, PMID 31824336 | untrained |

There is no trial showing pre-exhaustion superior for hypertrophy in trained
lifters. Rule 9 now forbids isolation immediately before a compound that shares
the muscle, puts compounds first, and places a priority muscle's direct work
immediately after them rather than at the end of the session.

## Order is a strength lever, not a growth lever

| Claim | Effect | Grade |
|-------|--------|-------|
| Pooled strength effect of order | g = -0.11, p = 0.306, null | well evidenced |
| Compounds gain more strength when placed first | g = 0.32, p = 0.034 | well evidenced |
| Isolation gains more strength when placed first | g = -0.58, p = 0.032 | well evidenced |
| **Effect on hypertrophy** | **g = 0.03, p = 0.862, null** | well evidenced |

Nunes 2021, PMID 32077380, 11 studies.

The benefit attaches to the **exercise**, not the muscle: whatever is trained
fresh gets better at being trained, which is a specificity effect rather than
an adaptation advantage. So the app must not sell reordering as a fix for a
lagging muscle's size. It is fine to say a lift placed early gets stronger.

This is why rule 10 now opens with "VOLUME ALLOCATION is the growth lever, not
order".

## Adding volume on top is not obviously right either

Barsuhn 2024, PMID 39665246. Trained men, 8 weeks, randomised to maintain
volume, add 30 percent, or add 60 percent. Sum of muscle thickness change:

| Group | Change |
|-------|--------|
| **Maintain** | **1.07 cm** |
| +30 percent | 0.76 cm |
| +60 percent | 0.70 cm |

The maintenance group gained the most. This is the only trial that tested the
exact manoeuvre this feature performs, and it points the wrong way.

Small: 55 randomised, 29 completed, 47 percent dropout, one lab, 8 weeks. It
should not overturn the dose-response meta-regression of 67 studies
(Pelland 2025, PMID 41343037, posterior probability 100 percent that more sets
means more growth). But it is enough to rule out aggressive automatic volume
increases.

Rule 10 therefore moves sets from leading muscles to lagging ones and holds the
weekly total roughly flat, rather than adding on top. That was already the
rule's shape before this research arrived, and the research is why it stays.

## Frequency is scheduling, not growth

Volume-equated frequency has no meaningful effect on hypertrophy across 25
studies including the trained-only subgroup (Schoenfeld 2019, PMID 30558493),
and the meta-regression finds an effect compatible with negligible
(Pelland 2025). Strength effects in well-trained populations are small at most,
g <= 0.58 upper body and <= 0.45 lower (Cuthbert 2021, PMID 33886099).

Rule 11 uses frequency only to keep a raised weekly set count executable and to
stop a single session stacking too many direct sets. It does not claim
frequency grows anything.

## What has no evidence at all

Both of these are returned as `no_source` by the pass, and both are load-bearing
for this feature. Neither is fixable by more searching.

**How big an imbalance must be before acting.** No trial has identified lifters
with an imbalance of size X, randomised them to targeted versus untargeted
programming, and measured whether it closed. `LAG_THRESHOLD = 0.5` levels in
`weak-points.ts` is a judgement and is labelled as one in the code.

The only defensible anchor is measurement noise: 1RM test-retest median CV is
4.2 percent, range 0.5 to 12.1 (Grgic 2020, PMID 32681399), which puts a 10
percent difference at or inside noise for many lifts. Note this bounds
comparing *two measurements of the same lift*, which is not quite what this app
does when it compares different muscles' best-ever estimates. Related, the
familiar 10 to 15 percent asymmetry threshold comes from injury-risk literature
that is weak on its own terms and does not transfer (Zhang 2022, PMID 35065297).

**How to reallocate volume.** No RCT has tested a specialisation block. Every
published set count for this is a coaching heuristic. The research pass
explicitly declined to supply a number, and this file will not invent one
either.

## The highest-value follow-up, and it needs the founder

Pelland 2025 found that classifying sets as **direct or indirect**, and
counting indirect sets at partial weight, was essential to predicting
adaptation. `setVolume.ts` currently counts a set toward the exercise's primary
`muscle_group` only, so a row counts one set for Back and zero for Biceps.

That means **arm volume is systematically undercounted**, which feeds the
volume half of the weak-point assessment. Fixing it would improve every volume
number in the app.

It is not done here because `src/lib/analytics/setVolume.ts` is covered by
golden rule 2. It needs the founder to ask.

## Caveats on the pass itself

The research pass reported its own limits, which is why it is trustworthy.
PubMed and PMC were blocked during it, so effect sizes come from abstracts and
full text was retrieved for only 2 of about 15 papers. The Nunes 2021 training
status breakdown is unverified. Remmert 2025, the source of the roughly 11
fractional sets per session flattening point, is a preprint and is not encoded
anywhere in this app.
