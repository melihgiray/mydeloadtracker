# Audit: the Codex local-LLM migration

Date: 2026-07-29
Auditor: Claude (Fable)
Scope: the reported migration of the AI coach (`/api/coach`) and the bar
scanner (`/api/scan`) from the Anthropic API to a locally hosted LLM.
Repo state audited: `e5c79f4` plus an untracked working tree.

> **Correction, same day.** The summary below was wrong on its central claim.
> The migration does exist, on a remote branch (`agent/local-ollama-coach-scanner`,
> draft PR #1) that my checks never looked at. See "Correction" at the end of
> this document for what was wrong, why the method missed it, and what still
> holds. The original text is left unedited so the error is legible.

## Summary

**The migration was not performed.** No source file was changed. Both AI
routes still call the Anthropic API exactly as they did before. The only
artifact produced was a new untracked file, `AGENTS.md`, which is a
find-and-replace copy of `CLAUDE.md` with "Claude" rewritten to "Codex".

That rename also broke three file paths that the document instructs a model
to read, so the document is not merely redundant, it is actively misleading.

Nothing needs to be reverted, because nothing was changed. What needs a
decision is whether the local-LLM migration should happen at all, and that
question turns out to be more consequential than it first appears (see
"Feasibility" below).

## Method

Each claim below is backed by a command that was run, so this is
reproducible rather than asserted.

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | Any uncommitted source change | `git diff --stat HEAD -- src/` | empty |
| 2 | Any Codex commit | `git log --oneline -15` | none; last commit is `e5c79f4`, mine |
| 3 | Work hidden elsewhere | `git stash list`, `git branch -a`, `git reflog -8` | no stashes, one branch, reflog shows only my commits |
| 4 | Local-LLM references in source | `grep -rniE "localhost\|127\.0\.0\.1\|ollama\|lm ?studio\|llama\|local_?llm\|baseURL\|base_url\|OPENAI_BASE" src/` | only Supabase URL matches, nothing LLM related |
| 5 | What the routes actually call | `grep -nE "new Anthropic\|apiKey\|MODEL" src/app/api/{scan,coach}/route.ts` | both still `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` |
| 6 | Is AGENTS.md a rename of CLAUDE.md | reverse the rename, then `diff` against `CLAUDE.md` | **byte identical** |
| 7 | Do AGENTS.md's paths exist | `test -e` on each referenced path | `.Codex/launch.json` MISSING, `Codex.local.md` MISSING |

## Findings

### F1. No migration occurred. Severity: informational, but blocking.

Checks 1 through 5. The working tree contains no modified source file, and
both routes construct an Anthropic client against `ANTHROPIC_API_KEY`. If
the local model was configured and tested somewhere, that configuration did
not reach this repository.

### F2. AGENTS.md is a duplicate that will drift. Severity: medium.

Check 6 proves it is `CLAUDE.md` with a global rename. Two documents stating
the same conventions is a maintenance hazard: the next time a convention
changes, one copy will be updated and the other will not, and a model
reading the stale copy will follow superseded rules. This is the ordinary
argument against duplicated documentation, and it applies with more force
here because these documents exist specifically to steer autonomous agents.

### F3. The rename broke real file paths. Severity: medium.

Check 7. `AGENTS.md` instructs a model to use `.Codex/launch.json` for the
dev server and to read `Codex.local.md` for session state. Neither exists.
The real files are `.claude/launch.json` and `CLAUDE.local.md`. A model
following `AGENTS.md` literally cannot start the dev server and will not
find the credentials, current state, landmines, or roadmap.

### F4. The rename produced a factual error. Severity: low, but telling.

`AGENTS.md` describes the bar scanner as using "Codex vision". The scanner
uses a vision-language model with a forced tool call. Codex is not a vision
provider. This is a small thing, but it is evidence that the rename was
mechanical rather than considered, which is why F3 happened too.

## Feasibility of the migration itself

Worth stating plainly before anyone attempts this again, because the two
routes are not equally portable.

### The coach (`/api/coach`) is portable, with caveats

It streams text and uses Anthropic prompt caching. A local model can stream
text. What is lost:

- **Prompt caching.** `context.ts` builds a large context block that is
  currently cached, which is why the coach is cheap to re-ask. Most local
  runtimes have no equivalent, so every message reprocesses the full
  context. On local hardware that is a latency cost, not a billing one.
- **Quality on long-context reasoning.** The coach reasons over eight weeks
  of training data. This is the part most sensitive to model capability.

### The scanner (`/api/scan`) is the hard one

This is the feature with the highest quality bar in the app, per
`CLAUDE.md`, and it is filmed for the demo. It requires three things at
once:

1. **Vision**, over up to 16 frames in a single request.
2. **Forced tool use.** The route sets
   `tool_choice: { type: "tool", name: "report_lift" }` so the model must
   return a structured `report_lift` payload. Local runtimes vary widely in
   whether they support forced tool calls; many support tools only as a
   suggestion, which would break `scan-mapping.ts`'s contract.
3. **Latency.** Measured production numbers are in `docs/SCANNER_FLOW.md`:
   p50 6.0s and p95 7.6s for a photo, p50 7.4s and p95 9.0s for 8 frames,
   p50 8.4s and p95 10.7s for 16 frames. A local multi-frame vision model
   on consumer hardware is unlikely to match this, and the scanner already
   sits at the edge of the 8 second perceived-wait target.

### The architectural blocker: production cannot reach a local machine

This is the decisive point. The app is deployed on Vercel. `/api/scan` and
`/api/coach` are server-side routes that run **in Vercel's infrastructure**,
not in the athlete's browser. A model hosted on the founder's computer at
`localhost` is not reachable from a Vercel serverless function.

So a local model works for local development only, unless one of these is
also true:

- the local machine is exposed publicly (a tunnel such as Cloudflare Tunnel
  or ngrok, plus authentication), and is running whenever anyone uses the
  app, or
- the app stops being deployed and runs only on the local network, which
  ends the PWA and the public demo, or
- inference moves into the browser (WebGPU), which is a different and much
  larger project.

None of these is impossible, but each is a product decision with real
consequences, and none of them is "swap the base URL".

## Recommendation

1. **Delete `AGENTS.md`, or replace its body with a one-line pointer to
   `CLAUDE.md`.** A pointer keeps the filename discoverable for tools that
   look for `AGENTS.md` by convention, without duplicating content that will
   drift. This is the smallest change that fixes F2, F3 and F4 together.
2. **Do not migrate the scanner** without first answering the reachability
   question above, and without a measured comparison against the recorded
   production latencies and a real accuracy check on actual gym photos.
3. **If the goal is cost**, say so explicitly, because there are cheaper
   moves that do not touch architecture: the scanner is already auth-gated,
   frames are already downscaled to 640px at quality 0.55, and the coach
   already uses prompt caching. A local model is not the only lever.
4. **If the goal is privacy or offline capability**, that is a legitimate
   and different goal, and it should be designed for deliberately rather
   than reached by swapping a client.

## What was verified and how

Every claim in this document maps to a command in the Method table, all run
against the working tree at `e5c79f4`. No source file was modified during
this audit. No test was run, because no code changed.

## Found but left alone

- `AGENTS.md` is still present and untracked. It is not deleted here because
  removing another agent's output is the founder's call, not mine.
- The research output for the program planner (`planner-research.json`)
  arrived in the same message as this audit request and has not yet been
  committed. It should be saved before it is lost.

---

# Correction

Added after Codex pointed out the gap. Everything above is the original
document; nothing in it was rewritten.

## What I got wrong

F1 said no migration occurred. It does exist, as 9 changed files on the
remote branch `agent/local-ollama-coach-scanner`, open as draft PR #1:

```
 .env.local.example            |  16 +++-
 README.md                     |  22 +++--
 docs/LOCAL_AI_ARCHITECTURE.md | 214 +++++++++++++++++++++++++++++++++++++
 package-lock.json             |  63 -------------
 package.json                  |   1 -
 src/app/api/coach/route.ts    |  51 +++++-----
 src/app/api/health/route.ts   |   4 +-
 src/app/api/scan/route.ts     | 127 ++++++++++++++++---------
 src/lib/ollama.ts             |  76 +++++++++++++++
```

The coach moves to Qwen, the scanner to Gemma, both through a new
`src/lib/ollama.ts` adapter. The adapter is good code: no new dependency,
server-side only, gateway token never reaches the browser, and it handles
Ollama's newline-delimited JSON stream properly including the trailing
partial line. `AGENTS.md` is NOT part of that PR, so F2 through F4 describe
an untracked local file of separate origin, not the PR's work.

## Why the method missed it

Check 3 used `git branch -a`. That lists local branches plus
**remote-tracking refs that have already been fetched**. This clone had
never fetched that branch, so there was no ref to list, and an empty result
read as "nothing exists" when it actually meant "nothing local knows about."
`git reflog` has the same blind spot: it only records this clone's history.

The check that would have caught it queries the remote directly:

```
git ls-remote --heads <remote>
```

which returns both `main` and `agent/local-ollama-coach-scanner`. The
general lesson, worth more than this one finding: **a negative result from
a local-only git command is not evidence about a remote.** Any future audit
that asks "did anyone do X" must query the remote before concluding no.

## What still holds

- **The architectural blocker is unchanged, and Codex agrees.** Vercel
  serverless functions cannot reach a Mac at `127.0.0.1`. The PR documents
  an authenticated gateway but does not implement one, so the branch is not
  deployable as it stands. Codex says the same and asks that PR #1 stay a
  draft. Agreed.
- **The scanner is still the risky half.** Forced-tool structured output
  can be validated, but multi-frame accuracy and latency against real gym
  footage are unmeasured. The production baseline to beat is in
  `docs/SCANNER_FLOW.md`: p50 8.4s and p95 10.7s for 16 frames.

## New finding: the PR is all-or-nothing

### F5. The PR removes `@anthropic-ai/sdk` from `package.json`. Severity: medium.

```
-    "@anthropic-ai/sdk": "^0.100.1",
```

This makes the change a full cutover. It contradicts the hybrid rollout
Codex itself recommends (local coach first, Claude scanner retained until
benchmarked), because a hybrid needs both clients present at once. It also
removes prompt caching from the coach with no replacement, which
`docs/LOCAL_AI_ARCHITECTURE.md` should state as a cost consequence rather
than a latency one.

If the hybrid is the plan, the dependency must stay and the branch needs a
per-route provider switch instead of a global one.

## The decision

The founder's answer to the open question was **cost**, so goal 1: keep the
cloud architecture and route models per surface rather than force local
inference. The reasoning and the arithmetic are in `docs/AI_COST.md`.

That does not close the local-model question, it just separates it from
this one. Privacy and offline capability are real, different goals, and PR
#1 is a reasonable starting point for them once the gateway exists.

## What was verified and how, for this correction

| Check | Command | Result |
|-------|---------|--------|
| Does the branch exist on the remote | `git ls-remote --heads` | yes, alongside `main` |
| What the branch actually changes | `git fetch` then `git diff --stat main...` | the 9 files above |
| Does it drop the Anthropic SDK | `git diff main... -- package.json` | yes, dependency removed |
| Is the adapter sound | read `src/lib/ollama.ts` in full | yes, see above |

No file on that branch was modified, and the branch was fetched to a
throwaway ref (`refs/remotes/audit/ollama`) rather than checked out.
