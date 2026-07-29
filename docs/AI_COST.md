# What the AI actually costs, and the levers

Date: 2026-07-29. Written after the founder confirmed the goal behind the
local-model experiment is **cost** (see `AUDIT_2026-07-29_codex.md`).

This is arithmetic, not a bill. Every input here is either a constant read
out of the code or a published price, and each is labelled. The app has now
been instrumented to report real per call token usage, so the next revision
of this document can replace the estimates with measurements. Until then,
treat the totals as the right order of magnitude and nothing finer.

## Where the money goes

Two routes call a model. They have completely different cost shapes, which
is the whole reason the fix below was needed first.

| Route | Shape | Dominated by |
|-------|-------|--------------|
| `/api/scan` | one shot, vision, forced tool call | image tokens |
| `/api/coach` | streaming chat over training history | cached context |

### Prices used

Per million tokens, from the Anthropic model table:

| Model | Input | Output |
|-------|-------|--------|
| `claude-sonnet-4-6` (current default) | $3.00 | $15.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

Cache reads cost about 0.1x the input price, cache writes about 1.25x at the
default five minute TTL.

### Image tokens

An image costs roughly `width * height / 750` tokens. The two capture paths
downscale differently, both in `bar-scanner.tsx`:

| Path | Max dimension | Typical frame | Tokens each |
|------|---------------|---------------|-------------|
| Recorded set (`grabFrame`) | 640 | 640 x 360 | ~307 |
| Single photo (`fileToDataUrl`) | 1024 | 1024 x 576 | ~786 |

## The bug that was costing money and accuracy

The client buffered up to **16** frames and uploaded all of them. The route
kept `raw.slice(0, 10)`. So on any set long enough to fill the buffer:

1. Up to six frames were compressed, uploaded over the athlete's mobile
   data, and thrown away on arrival.
2. Worse, the ten that survived were the **first** ten of an evenly spaced
   buffer, so they covered only the opening stretch of the set, roughly the
   first 60 percent, while the prompt told the model they ran "from start to
   finish". The last reps were invisible to a model being asked to count
   reps.

Both sides now share `MAX_SCAN_FRAMES` from `scan-mapping.ts`, and trimming
uses `evenlySample`, which keeps the first frame, the last frame, and an
even spread between. The client trims before upload, so the discarded frames
are never sent at all. Five tests pin this, including one asserting the last
frame survives.

This was free to fix in cost terms and is strictly better in coverage terms.
It does change what the model sees on long sets, from ten early frames to
ten spanning the whole set, so it belongs in the real camera test that is
already roadmap item P0-3. Nobody should assume it improved rep counting
until a real set proves it.

## Cost per call

Prompt and tool schema are counted at a flat ~600 input tokens, output at
~80 actual against a 512 cap.

### Scan, recorded set (10 frames)

| | Sonnet 4.6 | Haiku 4.5 |
|-|------------|-----------|
| Input, ~3,670 tok | $0.0110 | $0.0037 |
| Output, ~80 tok | $0.0012 | $0.0004 |
| **Per scan** | **~$0.012** | **~$0.004** |

### Scan, single photo

| | Sonnet 4.6 | Haiku 4.5 |
|-|------------|-----------|
| **Per scan** | **~$0.005** | **~$0.002** |

### Coach message

The context block carries `cache_control`, so a follow up question in the
same five minute window re reads it at roughly a tenth of the input price.
The first message of a conversation pays the 1.25x write premium. That means
**the coach is already cheap for multi turn use and expensive for one shot
use**, which is the opposite of the intuition, and it is why "ask the coach
one question and leave" is the pattern worth discouraging in the UI.

## The levers, ranked

1. **Route the scanner to a cheaper model.** Roughly 3x on the app's single
   most expensive call. The knob now exists: set `ANTHROPIC_SCAN_MODEL`
   without touching the coach. Blocked on one thing only, see below.
2. **The frame fix above.** Already done. Cuts upload bytes by up to 37
   percent on long sets and removes the coverage bug. No model change.
3. **Keep the coach's cache warm.** Already implemented. The lever left is
   product: encourage a conversation rather than a single question.
4. **Nothing else is worth touching yet.** Frames are already 640px at
   quality 0.55, the route is auth gated, and `max_tokens` is 512 on the
   scanner and 1024 on the coach. These are not where the money is.

### What blocks lever 1

Whether `claude-haiku-4-5` supports vision with a forced tool call is not
documented in anything I can read from here, and I am not going to guess at
a capability that the app's highest quality bar feature depends on. It is
also not the interesting question, because even if it is supported, the
question that matters is whether it reads a loaded barbell as accurately as
Sonnet does.

Both questions are answered by the same experiment, and it is cheap:

1. Set `ANTHROPIC_SCAN_MODEL=claude-haiku-4-5` in Vercel, on a preview
   deployment rather than production.
2. Run the same handful of real gym photos and one recorded set through
   both. The founder has to do this anyway for P0-3.
3. Compare weight, rep count, and exercise name against the truth, and
   compare latency against the p50 and p95 baselines in `SCANNER_FLOW.md`.
4. If it holds up, set the env var in production. If it does not, delete the
   variable and the app falls back to Sonnet with no code change.

An unsupported model surfaces immediately as an API error on the preview,
which answers the capability question at the same time.

## Why local inference is not the cost answer

The local model branch (PR #1) would take API spend to zero. It also
requires a Mac that is awake and serving whenever anyone uses the app, plus
an authenticated public gateway in front of Ollama that the PR documents but
does not implement. That is a real running cost in hardware, electricity,
and operational attention, and it trades a per call cost that scales with
usage for a fixed cost that does not.

At current volume the API spend is small enough that the trade is clearly
bad. It becomes worth revisiting when the scanner is running thousands of
times a day, and at that point the gateway is a real project rather than a
config change. Privacy and offline capability remain separate and
legitimate reasons to want the same branch, and they should be argued on
their own terms rather than on cost.

## Measurement, so this stops being arithmetic

`/api/scan` now returns the Anthropic usage object with each reading, and
`bar-scanner.tsx` forwards it to PostHog as an `ai_usage` event carrying
model, frame count, input, output, and both cache counters. After the next
deploy, a week of real scans gives the true distribution, and a model change
can be judged on measured spend rather than on this page.

The coach is not instrumented yet. It streams, so its usage arrives in the
final message event, and wiring it is a separate change.

## What was verified and how

| Claim | How |
|-------|-----|
| Client buffered 16, route kept 10 | read `bar-scanner.tsx:368` and `scan/route.ts:71` before the fix |
| The kept ten were the first ten | `raw.slice(0, 10)`, and the buffer is evenly spaced across the recording |
| The fix holds | 46 tests pass, up from 41; `npx tsc --noEmit` clean; `npm run build` compiles |
| Prices | Anthropic model table |
| Cache multipliers | Anthropic prompt caching documentation |

## Found but left alone

- The coach's token usage is not captured. Deliberate, it is a separate
  change against a streaming response.
- `max_tokens` on the scanner is 512 against an actual output near 80. Not
  worth trimming, unused output tokens are not billed.
- The `useEffect` exhaustive deps warning in `bar-scanner.tsx:213` predates
  this work and is untouched.
