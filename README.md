# WORLDWEAVER

> **Kiroween 2026** — AI-assisted cinematic 3D world studio (in development)

WORLDWEAVER is being developed as an entry for **Kiroween 2026**.

## Current status: Phase 2 — AI World Director

- **3D studio (Phase 1):** the "Crystal Kingdom at Dusk" world, generated
  deterministically from a seed; orbit, zoom and pan; selection from the
  viewport or the scene list; an inspector whose edits update the world and the
  scene; undo/redo and a timeline.
- **AI World Director (Phase 2):** describe what to create or change, in
  English or Arabic. The Director returns a structured proposal. You review it
  and click **Apply**: it is applied as one undoable step, or not at all. Model
  output is strictly validated and is never executed as code.
- **Two modes, always labelled in the UI:** **LIVE** (real Gemini through a
  local proxy) and **RECORDED** (pre-written sample responses, not live AI).

World Morph, Living Characters, Parallel Futures and the Causal Ledger are
**planned**. See [`.kiro/steering/status.md`](.kiro/steering/status.md) and
[`docs/`](docs/) for the detailed status, plan and issue register.

## Run locally

Requires **Node.js 24** or newer.

```bash
npm install
npm run dev          # studio + Director proxy at http://127.0.0.1:5173/
```

Other commands:

```bash
npm test             # unit tests (no network)
npm run typecheck    # browser, server and test projects
npm run build        # type check + production build into dist/
npm run preview      # serve dist/ with the Director proxy at http://127.0.0.1:4173/
npm run test:e2e     # browser acceptance tests (uses your installed Google Chrome; recorded mode)
npm run test:live    # OPT-IN live Gemini compatibility test (needs GEMINI_API_KEY; max 9 calls)
```

## AI World Director

### Recorded mode (default, no key needed)

Without a key the Director runs in **RECORDED** mode. Responses are
pre-written samples chosen by keywords, for example "crystal garden",
"lanterns in the sky", "drifting isles", or in Edit mode "violet" and "raise".
They are useful for trying the studio, demos without network access, and
tests. They are **not** AI output, and the UI says so on the badge, the preview
and the panel footer.

### Live mode (your own Gemini key)

The key is read **only by the local Node.js proxy** from its environment. It is
never sent to the browser, never put in a URL, and never logged. Set it in
**your own terminal**, in the same window that runs the studio. Never paste it
into chat, issues or files that get committed.

Windows PowerShell 5.1 (the key is hidden while you type):

```powershell
$secure = Read-Host -Prompt 'Gemini API key' -AsSecureString
$env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
Remove-Variable secure
npm run dev
```

PowerShell 7+: `$env:GEMINI_API_KEY = Read-Host -Prompt 'Gemini API key' -MaskInput`

The variable lasts only for that terminal window.

The startup log shows `[director] mode=LIVE … key=configured`, and the
Director badge shows **LIVE**. To force a mode, set `DIRECTOR_MODE` to `live`
or `recorded`.

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | (unset) | Enables live mode. Server-side only. |
| `DIRECTOR_MODE` | auto | `live` or `recorded`. Auto means live if a key is set. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model name. |
| `DIRECTOR_TIMEOUT_MS` | `30000` | Upstream timeout, 1000–60000. |
| `DIRECTOR_MIN_INTERVAL_MS` | `5000` | Minimum spacing between live calls, at least 5000. |
| `DIRECTOR_RECORDED_LATENCY_MS` | `700` | Simulated delay in recorded mode, 0–5000. |

Safety rules built in: the proxy accepts only localhost, same-origin requests;
one request runs at a time; at least 5 s between live calls; a 30 s timeout;
**no automatic retries** (Retry is always your choice); and model output is
validated on the server and again in the browser.

Health check (shows the mode and whether a key is configured, never the key):
`http://127.0.0.1:5173/api/director/health`.

## Known limitations

- **Live Gemini output has not been verified yet** with the new proposal
  schema. Run `npm run test:live` with your key to verify (WW-025).
- Worlds are kept in memory only. Reloading the page resets to the Crystal
  Kingdom (WW-016).
- Browser tests use software WebGL and take several minutes on a busy machine
  (WW-029).
- Real-GPU performance has not been measured (WW-009).

## Repository

- **Remote:** https://github.com/malakbassaam-hub/WORLDWEAVER.git
- **License:** MIT
