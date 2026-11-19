# Issue Register and Schedule — Pending Delta from `phase3/world-morph`

Kiro did **not** edit `docs/ISSUE_REGISTER.md` or
`docs/DEVELOPMENT_SCHEDULE.md` on this branch, because they may be edited
concurrently in Kilo Code's integration worktree. Apply this delta when the
branches are integrated. It changes no existing ID, owner, severity or date.

## Evidence to append to existing issues

| Issue | Append (dated 2026-11-18) |
|---|---|
| WW-031 | The four defaults are implemented as a configurable `MorphPolicy` (`src/director/morph.ts`) with `MORPH_POLICY_STATUS.approved = false`. Both choices of D-WM-1 and D-WM-3, and D-WM-2 on and off, are unit-tested. Nothing is enabled. Decision still required; target 2026-11-22 unchanged. |
| WW-023 | World Morph remains provisional; conformance still BLOCKED. |
| WW-025 | Create and Edit system instruction is byte-identical on `phase3/world-morph` (test `systemInstructionFor`), so a live run on `phase2/director` remains valid for those tasks. Morph needs one more live case (WM-07). |
| WW-030 | `phase3/world-morph` touches none of the four conflicting shared files; it must be merged after the integration branch is green. |

## New issues to register (IDs to be assigned on merge)

Use the next free IDs at the time of merging.

| Title | Severity | Owner | Target | Status | Acceptance criteria |
|---|---|---|---|---|---|
| World Morph has no UI task | Medium | Kiro | 2026-11-24 | BLOCKED (WW-031) | Morph task in `src/ui/director.ts` with pin-rejection reasons and the policy notice; controller unit tests unchanged and passing |
| World Morph studio wiring and transition hook not in `src/main.ts` | Medium | Kilo Code (shared file) | 2026-11-24 | BLOCKED (WW-031, WW-030) | Hook as in KILO_HANDOFF.md §2b; transition cancelled on undo, redo, edit, context loss and dispose |
| World Morph browser acceptance tests not written | Medium | Kilo Code (shared browser tests), Kiro (cases) | 2026-11-25 | BLOCKED (UI) | The 8 cases in KILO_HANDOFF.md §3 pass 3 consecutive times with `DIRECTOR_MORPH=1` |
| Live morph case missing from `test:live` | Medium | Kiro | 2026-11-25 | BLOCKED (WW-025 review) | One morph case added (9th request, cap unchanged); Malak runs it; result recorded |
| `phase3/world-morph` not merged | Medium | Malak (approval), Kilo Code (integration) | 2026-11-26 | BLOCKED (WW-030) | Merged into the integration branch after it is green; all suites pass on the result |

## Schedule rows to add (existing rows unchanged)

| Target date | Owner | Task | IDs |
|---|---|---|---|
| 2026-11-18 | Kiro | WM-01, WM-02 and WM-03 implemented ahead of target; WM-04 and WM-05 partly (contract, coordinator, controller), all disabled, on `phase3/world-morph` | WM |
| 2026-11-24 | Kiro | Morph UI task, once WW-031 is decided | WM-05 |
| 2026-11-24 | Kilo Code | `main.ts` morph wiring and transition hook; `DIRECTOR_MORPH` in the browser web-server env | WM-04, WM-K1 |
| 2026-11-26 | Kilo Code, Malak | Merge `phase3/world-morph` into the green integration branch | WM-08 |
