# Live Gemini Test Runbook

How to verify the AI World Director against **real Gemini** with your own key
(issues WW-025 and P2-08). Only you run these steps. Kiro never asks for,
sees or stores the key.

- **Branch:** `phase2/director` (at `efa19be` or later)
- **Model:** `gemini-3.5-flash-lite`, the default in `server/director/config.ts`
- **Schema:** World Proposal schema v2 (`PROPOSAL_RESPONSE_SCHEMA` in
  `src/director/schema.ts`), sent as `generationConfig.responseSchema`
- **Requests:** the live test sends **8** (hard cap 9, at least 5.3 s apart,
  no retries). The smoke test sends **2**. Total: **10** requests.

## Before you start

- Use a key from a Google AI Studio project **without billing enabled**, so
  the requests stay on the free tier. If billing is enabled, these 10
  requests may be charged.
- Use **one** PowerShell window for every step. The key lives only in that
  window and disappears when you close it.

### Never do this

| Don't | Why |
|---|---|
| `$env:GEMINI_API_KEY = 'AIza…'` typed on the command line | PSReadLine saves typed commands to its history file on disk |
| Put the key in `.env` or any file in the repository | Files can be committed or shared by accident |
| Paste the key into chat, issues or screenshots | It is a password |
| Run `echo $env:GEMINI_API_KEY` or similar | It prints the key |

The steps below read the key with `Read-Host -AsSecureString`. Input typed at
that prompt is hidden and is **not** saved to PowerShell history.

## Step 1: Set the key (hidden input)

```powershell
Set-Location C:\Users\user\WORLDWEAVER
git branch --show-current          # must print: phase2/director
git status --short                 # must print nothing

# Use the default model and live mode.
Remove-Item Env:GEMINI_MODEL, Env:DIRECTOR_MODE -ErrorAction SilentlyContinue

# Paste or type the key at the prompt; nothing is shown.
$secure = Read-Host -Prompt 'Gemini API key (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); Remove-Variable secure, bstr }

# Prints only True or False, never the key.
"Key configured: $(-not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY))"
```

Continue only if it prints `Key configured: True`.

## Step 2: Run the live compatibility test

```powershell
npm run test:live
```

It takes about 1–3 minutes. Expected end of the output:

```
[live] 9/9 cases passed, 8 live calls.
 Test Files  1 passed (1)
      Tests  9 passed | 1 skipped (10)
```

The 9 cases are the 8 live requests plus one replay check.

The skipped test is the "BLOCKED" report, which runs only when no key is
set. The ninth passing test is a replay check that makes **no** model call.

Show the results table (it contains no key):

```powershell
(Get-Content test-results\live-gemini.json -Raw | ConvertFrom-Json).results |
  Format-Table id, status, code, model, operations, applicable -AutoSize
```

The `model` column shows the model version Gemini reports. It should start
with `gemini-3.5-flash-lite`.

### The 8 live cases

| Case | Checks |
|---|---|
| `create-en` | English create request: valid, applicable, adds entities |
| `create-ar` | Arabic create request: valid and applicable |
| `create-mixed` | Mixed Arabic and English: valid and applicable |
| `edit-refs` | Edits target existing entity refs only |
| `pinned-guard` | The pinned citadel is never changed |
| `limits` | An oversized request stays within limits, or is rejected cleanly |
| `adversarial` | Prompt injection produces nothing outside the schema |
| `edit-move-hide` | Move and hide edits: valid and applicable |
| `replay` | No call: the live proposal is applied, undone, redone and replayed identically |

### If a case fails

| `code` | Meaning | What to do |
|---|---|---|
| `NO_KEY` | The key is not set in this window | Repeat Step 1 in the same window |
| `AUTH` | The key is invalid, restricted, or the Gemini API is not enabled | Check the key in Google AI Studio |
| `MODEL_NOT_FOUND` | `gemini-3.5-flash-lite` is not available to this key | Report it. Do not change the model without agreeing a new name |
| `RATE_LIMITED` | Free-tier quota or rate limit | Wait for the reset, then run once more (another 8 requests) |
| `UPSTREAM_BAD_REQUEST` | Gemini rejected the request or schema format | Report it: this is a real compatibility failure for Kiro to fix |
| `INVALID_PROPOSAL`, `CLIENT_INVALID` | Gemini's output did not match the schema | Report it, with the case id and `detail` |
| `TIMEOUT`, `NETWORK` | Connection problem | Check the connection, then run once more |

For `limits` and `adversarial`, a cleanly rejected proposal counts as PASS.

## Step 3: Create and Edit smoke test (2 requests)

In the **same** window:

```powershell
npm run dev
```

1. The startup log must show
   `[director] mode=LIVE · model=gemini-3.5-flash-lite · key=configured`.
2. Optional: open `http://127.0.0.1:5173/api/director/health`. It must show
   `"mode":"live"`, `"keyConfigured":true` and `"liveReady":true`, and never
   the key.
3. Open `http://127.0.0.1:5173/`. The Director badge must show **LIVE**.

**Create**

1. Choose **Create**, type
   `Add a small grove of glowing crystal spires and two lanterns above the main isle.`
   and click **Generate** (or press Ctrl+Enter).
2. You see "Asking Gemini…", then a preview marked **LIVE · Gemini**. The
   Scene list still shows **27 entities**, because nothing is applied yet.
3. If every operation shows ✓, click **Apply**. The entity count rises, and
   the timeline shows a "Director: …" entry with an **AI** tag.
4. Press **Ctrl+Z**: the count returns to 27 in one step. **Ctrl+Shift+Z**
   restores the change.

**Edit** (wait at least 5 seconds after the first request)

1. Choose **Edit**, type `Make Sentinel Spire I violet and raise it a little.`
   and click **Generate**.
2. The preview should list changes to “Sentinel Spire I”. Click **Apply**.
3. Select Sentinel Spire I. The inspector shows the violet swatch active and a
   higher Y position.

If a preview shows ✕ lines, Apply stays disabled on purpose. Note the reason
text shown under the ✕.

Stop the server with **Ctrl+C**.

## Step 4: Remove the key from the window

```powershell
Remove-Item Env:GEMINI_API_KEY
"Key configured: $(-not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY))"   # False
```

Or close the window.

## What to send back (no key)

1. The `[live] x/9 cases passed, n live calls` line and the `Tests …` summary line.
2. The results table from Step 2.
3. Create: worked or not, and any error title or ✕ reason.
4. Edit: worked or not, and any error title or ✕ reason.

Kiro then records the results in `.kiro/steering/status.md` and the issue
register, and closes WW-025 and P2-08 if everything passed. World Morph does
not start until these results are reviewed.
