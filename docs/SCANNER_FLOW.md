# Bar scanner flow: state inventory

Every state the flow can be in, from tapping Scan to a logged set. Written for
the filmable-demo pass. "Now" is the behavior before that pass; fixes landed in
the commits that follow this document.

Entry points: the Scan button in the Log header (all viewports), which opens
`/scan?draft=1`, and the standalone `/scan` route. Endpoint: `POST /api/scan`
(auth required, forced tool, 30s server cap).

| # | State | Trigger | Now | Target |
|---|-------|---------|-----|--------|
| 1 | Idle (choose) | Land on /scan | Two cards: photo, record | Same, plus camera-use sentence before any prompt |
| 2 | Permission pending | Tap Record a rep | Nothing changes while the browser prompt is up | Pending card naming why the camera is needed |
| 3 | Permission denied | User denies | Bare red text line | Recovery card: how to re-enable, manual-log fallback |
| 4 | Live preview | Permission granted | Video + Record button | Same, plus framing hint (bar and plates, side angle) |
| 5 | Countdown | Tap Record a set | 3-2-1 overlay | Same |
| 6 | Recording | Countdown ends | Red pill, elapsed seconds, 90s cap, bounded 16-frame buffer | Same |
| 7 | Uploading | Stop and analyze | Indistinguishable from processing; one spinner | Real upload progress (XHR), then processing |
| 8 | Processing | Upload done | "Reading the bar" spinner, no timeout, no retry | Named stages, 25s timeout, retry without re-capture |
| 9 | Result, confident | detected true, high conf | Form-like card, small inputs | Money screen: large readouts, tap to correct, one primary action |
| 10 | Result, low confidence | conf medium/low | Small colored caption only | Fields marked for review, confirm-style primary button |
| 11 | No bar detected | detected false | Model note in a card | Friendly message, one concrete retry suggestion, retry button |
| 12 | API error | 4xx/5xx | Bare red text (server copy is clean) | Error card with retry |
| 13 | Timeout | Slow model/network | Spinner forever | Timeout card at 25s with retry |
| 14 | Offline | No network | Raw "Failed to fetch" | Friendly offline copy, retry |
| 15 | Photo unreadable | Bad file | Friendly text | Same, in card |
| 16 | Too few frames | <2 frames captured | Friendly text | Same, in card |
| 17 | Logging | Tap the primary action | Button spinner | From Log, add to the active workout draft. Standalone, insert immediately. |
| 18 | Logged | Draft update or insert succeeds | Text with exclamation point, auto-redirect 1.2s | From Log, confirm the set number and return to the workout. Standalone, show set N today and e1RM vs best or PR. Stay on screen. |
| 19 | Log error | Not signed in, DB error | Bare red text | Same copy, in the card |

## Measured latency

Against the live production endpoint, signed in, from a browser. Frames were
built by the same path the app uses (640px max dimension, JPEG quality 0.55,
about 23KB each), so the payloads are representative. Percentiles are
nearest-rank; at these sample sizes p95 is the slowest observed call.

| Payload | n | min | p50 | p95 | max |
|---------|---|-----|-----|-----|-----|
| 1 photo | 10 | 5.5s | **6.0s** | **7.6s** | 7.6s |
| 8 frames | 10 | 5.5s | **7.4s** | **9.0s** | 9.0s |
| 16 frames | 8 | 7.6s | **8.4s** | **10.7s** | 10.7s |

Every call succeeded and detected the bar. A recorded set sends between 8 and
16 frames (the buffer halves at 16), so the real recorded-set p50 sits between
7.4s and 8.4s. The photo path meets the 8s target at p50 and p95; the recorded
set meets it at p50 only.

Caveat: latency was measured by repeating one real barbell photo, so it
reflects payload size and output length honestly, but says nothing about
rep-counting accuracy on genuine motion.

Data notes:
- Weight semantics: total bar weight (matches weight-semantics.ts for barbell).
- Stored shape identical to manual logging: canonical kg via toKg, reps int,
  rpe null. Covered by scan-mapping tests.
- Sessions: scans launched from Log update the local workout draft and are
  stored when the athlete saves that workout. Standalone scans still append to
  today's existing "Scanned" session instead of creating one session per set.
- Draft reconciliation: each scan replaces the next untouched planned slot for
  that exercise. Manual rows and drafts written before origin tracking are
  never overwritten. Once planned slots are exhausted, later scans append.
- Draft weights carry their display unit. If the athlete changes kg/lb, Log
  and draft-mode Scan convert every stored number through canonical kilograms
  before interpreting or saving it. Legacy unit-less drafts are left numeric
  and marked as current because their historical unit cannot be inferred.
- Failure reasons are tracked to PostHog as scan_failed with a reason field.
