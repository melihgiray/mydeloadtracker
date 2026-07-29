# What the AI actually costs, and the levers

Date: 2026-07-29. Written after the founder confirmed the goal behind the
local-model experiment is **cost** (see `AUDIT_2026-07-29_codex.md`).

Cloud costs here are arithmetic, not a bill: every input is either a
constant read out of the code or a published price. Local latency numbers
ARE measurements, taken on the founder's Mac against the real models. Both
are labelled as such throughout. The app is now instrumented to report per
call token usage and which provider answered, so a later revision can
replace the cloud estimates with real traffic.

**Outcome so far:** the app runs local-first with an automatic Claude
fallback. The coach defaults to local, the scanner stays on Claude in
production until a gym benchmark says otherwise, and production is still
cloud-only until a gateway exists. The reasoning for each is below.

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

1. **Run the coach locally.** Takes its cost to zero, and it measured
   faster to first token than the cloud. Shipped and on by default wherever
   `OLLAMA_BASE_URL` is set, which today means development.
2. **The frame fix above.** Shipped. Cuts upload bytes by up to 37 percent
   on long sets and removes the coverage bug. No model change.
3. **Route the scanner to a cheaper model.** Roughly 3x on the app's single
   most expensive call. The knob exists: set `ANTHROPIC_SCAN_MODEL` without
   touching the coach. Blocked on the capability question below.
4. **Run the scanner locally.** The largest remaining saving and the one
   with real risk attached. Blocked on the gym benchmark, not on code.
5. **Keep the coach's cache warm.** Already implemented for the cloud path.
   The lever left is product: encourage a conversation rather than a single
   question.
6. **Nothing else is worth touching yet.** Frames are already 640px at
   quality 0.55, the route is auth gated, and `max_tokens` is 512 on the
   scanner and 1024 on the coach. These are not where the money is.

### What blocks lever 3

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

## Local inference, measured

The first version of this document argued against local models on cost. That
argument was made without measuring anything, and measuring changed it.

Benchmarked on the founder's M5 Pro, 24 GB, with `gemma4:12b`, which reports
`completion, tools, thinking, vision`. Frames were 640 x 360 JPEGs, ten of
them distinct, matching what the scanner actually sends.

| | Local `gemma4:12b` | Claude in production |
|-|--------------------|----------------------|
| Scan, 10 frames | 8.4s to 11.2s | p50 8.4s, p95 10.7s |
| Scan, 1 frame | 9.8s to 10.9s | p50 6.0s, p95 7.6s |
| Scan, cold model load | 12.7s | n/a |
| Coach, time to first token | 1.98s | typically slower |
| Coach, full answer | 23.2s | comparable |

Three things came out of this that were not obvious beforehand:

1. **Latency is at rough parity on the recorded-set path**, which is the
   expensive one. It is worse on the single photo path.
2. **Structured output works.** Ollama has no forced tool call, but it does
   constrain generation to a JSON schema, and every test call returned valid
   schema-conforming JSON.
3. **Honest uncertainty survives.** Given a non-gym image the model reported
   `detected: false` with a note saying no equipment was visible, rather than
   inventing a lift. That is the behaviour the app requires and it was the
   thing most likely to fail.

Prompt tokens for ten distinct frames came to 1,338 against 433 for one, so
roughly 100 tokens per extra image. Gemma pools vision tokens far more
aggressively than Claude's `width * height / 750`.

## What the fallback does and does not protect

The app now runs local-first with an automatic Claude fallback. The fallback
is what makes local-by-default safe, but only for failures it can see.

**Detectable, so the fallback works:** the Mac is asleep, Ollama is not
running, the tunnel is down, the request times out, the model returns
something that fails the schema check. Verified in tests: a closed port
rejects in under two seconds and an unresponsive host honours the timeout.

**Not detectable, so the fallback does nothing:** the local model returns a
well-formed, confident, wrong answer. A scanner that reads a 100 kg bar as
60 kg produces valid JSON and a completely normal happy path, and the
athlete logs bad data.

So **availability is solved in code and accuracy is not.** That asymmetry is
the whole reason the two surfaces get different defaults:

| Surface | Default | Why |
|---------|---------|-----|
| Coach | local | Text. Quality degrades visibly, the athlete can re-ask, and a bad answer costs nothing but a re-read. |
| Scanner | **cloud in production** | A wrong number gets written to the training log, and nothing in the system can tell it is wrong. |

The scanner runs locally in development, which is both free and the way to
run the benchmark that would change its production default.

## What would move the scanner to local

A real gym benchmark, which is already roadmap item P0-3:

1. Photograph loaded bars at known weights, dim and bright, plus one recorded
   set at a known rep count.
2. Run each through both providers by flipping `AI_SCAN_PROVIDER`.
3. Compare weight, rep count, and exercise name against the truth.
4. If local matches on a set large enough to mean something, flip production.

Until that exists, no one should claim the local scanner is good enough,
including me. The latency numbers above say it is fast enough. They say
nothing at all about whether it can read a plate.

## Why production is still cloud-only

A Vercel serverless function cannot reach a Mac at `127.0.0.1`. Turning on
local inference in production needs an authenticated HTTPS gateway, which
PR #1 documents and does not implement. Setting `OLLAMA_BASE_URL` in Vercel
without that gateway would make every request wait for the timeout and then
fall back, which is strictly worse than not setting it.

The Mac also has to be awake. With the fallback in place that is a graceful
degradation rather than an outage, which is the main thing the fallback
buys, but it does mean the local hit rate is whatever fraction of the time
the machine is up.

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
| The fix holds | 65 tests pass, up from 41; `npx tsc --noEmit` clean; `npm run build` compiles |
| Local latency and schema conformance | ran real requests against Ollama on this Mac, distinct frames, times in the table above |
| Local honest uncertainty | fed a non-gym image, model returned `detected: false` rather than inventing a lift |
| Fallback fires on failure | `src/lib/ollama.test.ts` against a closed port and an unresponsive host |
| Coach style constraints hold | ran the real prompt against the real model, asserted no dashes, LaTeX, or exclamation points |
| Prices | Anthropic model table |
| Cache multipliers | Anthropic prompt caching documentation |

## Found but left alone

- The coach's token usage is not captured. Deliberate, it is a separate
  change against a streaming response.
- `max_tokens` on the scanner is 512 against an actual output near 80. Not
  worth trimming, unused output tokens are not billed.
- The `useEffect` exhaustive deps warning in `bar-scanner.tsx:213` predates
  this work and is untouched.
