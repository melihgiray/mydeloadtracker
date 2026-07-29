# Local AI architecture

This document is the shared reference for the local-model migration. Read it
before changing the coach, scanner, model settings, or deployment topology.

## Decision summary

MyDeloadTracker now uses self-hosted Ollama models instead of a hosted model
API for its two AI surfaces:

| Surface | Model | Why this model | Output contract |
| --- | --- | --- | --- |
| Personal coach | `qwen3:14b` | Strong instruction following and long-form training discussion at a size that is practical on Apple Silicon. | Plain text streamed to the existing chat UI. |
| Bar scanner | `gemma3:12b` | Accepts images and can produce schema-constrained JSON. | Validated `ScanReading` JSON. |

This is intentionally **not** a replacement for deterministic training
analytics. The readiness score, deload detection, volume calculations, e1RM
trends, and next-session targets remain ordinary TypeScript functions. The
models explain and contextualize those results; they do not authoritatively
calculate them.

## Request flow and trust boundary

```text
Browser
  -> Next.js API route (Supabase authentication + athlete-specific context)
  -> Ollama directly in local development, or an authenticated private gateway
  -> local model running on the Mac
```

The browser must never call Ollama directly. It would expose the model server,
skip the existing Supabase authentication boundary, and allow callers to bypass
the server-side prompt and result validation.

The Next.js routes remain the application boundary:

- `src/app/api/coach/route.ts` authenticates the athlete, loads their training
  data, builds the eight-week summary, and streams only model text to the UI.
- `src/app/api/scan/route.ts` authenticates the athlete, limits the number and
  total size of image frames, adds the athlete's exercise history as a prior,
  and validates the scanner result before returning it.
- `src/lib/ollama.ts` is the only code that knows how to call the Ollama REST
  API. It also attaches the optional gateway token. Do not duplicate fetch
  logic in feature routes.

When the app is hosted on Vercel, the Mac receives the selected athlete's
already-composed context or images. It does not need Supabase credentials and
must not be given them. The data travels over TLS to infrastructure controlled
by us, rather than to an external model provider, but it is still personal
training data and should be treated accordingly.

## Why the coach route is shaped this way

`/api/coach` preserves the existing product behavior:

1. It gets the authenticated user from Supabase.
2. It calculates a compact, inspectable summary of their last eight weeks.
3. It adds that summary and the coaching policy as a `system` message.
4. It keeps only the most recent 12 chat messages.
5. It asks Qwen for a direct response (`think: false`) and translates Ollama's
   newline-delimited JSON stream into the plain text stream the React component
   already understands.

The history cap is a deliberate product and reliability choice. The training
summary is more valuable than an old conversational turn. Without the cap,
long chats can crowd the athlete context out of the model window and consume
large amounts of unified memory. If the product needs durable conversational
memory later, summarize old turns server-side rather than blindly expanding the
window.

The coach uses a low temperature (`0.25`) because it should be consistent and
data-led, not creative. It has a maximum of 1,024 generated tokens so an
otherwise simple question cannot pin the local model indefinitely.

## Why the scanner uses a JSON schema, not free text

The old scanner depended on a forced tool call. Local Ollama supports a JSON
schema through its `format` field, so `src/app/api/scan/route.ts` now requests
the exact reading shape consumed by `src/lib/scan-mapping.ts`.

The schema is necessary but not sufficient: models can still malfunction or
compatible servers can be misconfigured. `parseReading` performs a second
runtime check before the API returns data. Unknown or malformed values become a
safe scan failure rather than a broken UI or an unreviewed logged set.

Gemma reads base64 image bytes in the same request. It receives up to ten
validated frames, never a browser-accessible model endpoint. The existing UI
still asks the athlete to review uncertain readings before logging a set.

## Configuration

Copy `.env.local.example` to `.env.local` and set only what differs from the
defaults:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_COACH_MODEL=qwen3:14b
OLLAMA_SCAN_MODEL=gemma3:12b
OLLAMA_KEEP_ALIVE=10m
OLLAMA_CONTEXT_WINDOW=16384
```

Pull the models on the Mac that runs Ollama:

```bash
ollama pull qwen3:14b
ollama pull gemma3:12b
```

The defaults are intentionally explicit per feature. Do not use one general
`OLLAMA_MODEL` for both: the coach is text-only, while the scanner requires a
vision-capable model and structured output.

`OLLAMA_KEEP_ALIVE` avoids repeatedly loading a model between requests. It
improves perceived latency but retains unified memory. Reduce it on a laptop
used for other heavy work. `OLLAMA_CONTEXT_WINDOW` is set to 16K because the
coach needs the athlete context plus recent turns; increasing it uses more
memory and should follow a measured need, not a guess.

## Deployment: local development vs. Vercel

### Local development

Run Ollama and Next.js on the same Mac. The default base URL works because the
Next.js server can reach `127.0.0.1:11434`.

```bash
ollama list
npm run dev
```

Open the authenticated coach and scanner flows. `/api/health` reports the
configured model names; it intentionally does not reveal a gateway URL or any
secret.

### Public deployment

Vercel cannot reach `127.0.0.1` on a developer's Mac. To use this architecture
in production, point `OLLAMA_BASE_URL` at a private HTTPS gateway that forwards
to Ollama on the Mac. Set the same high-entropy `OLLAMA_GATEWAY_TOKEN` on Vercel
and the gateway. The gateway must reject every request without a valid bearer
token.

Minimum gateway controls:

- HTTPS only; do not expose port `11434` to the public internet.
- Permit only the required Ollama route(s), normally `POST /api/chat`.
- Verify the bearer token before forwarding any request.
- Enforce request-size limits; scanner uploads can be large even after client
  compression.
- Add request logging that records timing and model name, never prompt text,
  images, tokens, or authorization headers.
- Add rate limits before inviting public traffic. One 12B vision request can
  monopolize a local machine.

A private tunnel or VPN is suitable if it terminates in this authenticated
gateway. The Mac must remain powered, online, and protected by normal OS
updates and disk encryption. This topology is appropriate for an early product
or personal deployment; sustained multi-user traffic belongs on dedicated
inference hardware.

## Operational notes and known trade-offs

- The existing scanner client gives a request 25 seconds before showing a retry
  state. Gemma may need more time for many frames on a busy Mac. Measure real
  device performance before raising that threshold; do not hide a stuck request
  behind an unlimited spinner.
- Keep Qwen and Gemma warmed only if available memory permits it. If both are
  held in memory simultaneously, normal desktop use can suffer.
- The health route is configuration-only. It does not guarantee a model is
  pulled or that a remote gateway is reachable. Add an authenticated operational
  probe later if monitoring needs that signal.
- Local models can still hallucinate. The coach's safety policy, deterministic
  calculations, input bounds, and manual review of scans are product controls,
  not optional polish.
- The scanner change should be evaluated against a labeled set of real gym
  images and clips before replacing a production provider. Include plate color,
  mismatched plate sizes, dumbbells, machines, poor lighting, and ambiguous
  rack shots. Measure exercise accuracy, weight error, rep-count error, JSON
  validity, latency, and manual-correction rate.

## Verification checklist for future changes

Before merging an AI-related change:

1. Run `npm test` and `npx tsc --noEmit`.
2. Confirm `/api/coach` still requires an authenticated user.
3. Confirm the chat UI still receives incremental plain text, not Ollama JSON.
4. Test a short and a long conversation; verify the athlete summary remains
   available after the history cap takes effect.
5. Test the scanner with one photo and a multi-frame capture. Verify malformed
   model output becomes a safe error response.
6. Test with the exact production gateway configuration; a local-only success
   does not validate Vercel connectivity.
7. Record the model tags and Ollama version used for any scan accuracy claim.

## Change log

### Local AI migration

- Replaced the coach's Anthropic SDK stream with an Ollama adapter and
  `qwen3:14b` default.
- Replaced the scanner's forced tool call with Gemma 3 12B vision plus a strict
  JSON schema and a second runtime validation pass.
- Added a single server-only Ollama client, optional gateway authentication,
  explicit model configuration, and configuration-only health output.
- Removed the now-unused Anthropic SDK dependency so the deployed server has
  one less provider client and transitive dependency chain to maintain.
- Preserved Supabase authentication, the deterministic analytics layer, the
  coach UI stream format, scanner image limits, and human review before logging.

When a future change modifies this architecture, update this section and the
relevant decision above in the same pull request. The reason for a behavior
change belongs next to the code and in this document, not only in chat history.
