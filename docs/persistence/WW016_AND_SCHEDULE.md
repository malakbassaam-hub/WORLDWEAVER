# WW-016 Status Proposal and Schedule Adjustments (2026-11-21 to 2026-12-03)

From Kiro, 2026-11-20. **Proposal only.** `docs/ISSUE_REGISTER.md`,
`docs/DEVELOPMENT_SCHEDULE.md` and the steering files were not edited
(Kilo Code may be editing them). No existing date is changed; rows marked
*(existing)* keep their dates.

## WW-016 — "World state is in memory only"

| Field | Current | Proposed |
|---|---|---|
| Status | BLOCKED (decision) | **PARTIAL**: the approach was approved on 2026-11-20 (local storage plus JSON export and import); implemented and unit-tested on `feature/world-persistence-1120`; not mounted in the studio; not browser-tested |
| Evidence to append | — | Save format v1 with checksum, strict validation and reducer rebuild; verified local save with backup; export/import; restore policy (session rebuilt; history, ledger and futures reset); 52 unit tests, 11 of 11 mutation checks; build PASS |
| Remaining for DONE | — | Studio wiring (`INTEGRATION.md` §1 to 2); browser cases 1 to 7 (`INTEGRATION.md` §5) passing 3 times |
| Not in scope of WW-016 (new item) | — | Persisting the Causal Ledger and Parallel Futures, and a SHA-256 ledger chain. These need a decision on whether history should survive a reload |

`status.md` (steering), when next edited: "World state persistence:
PLANNED" becomes "PARTIAL: local save, backup, export and import implemented
on `feature/world-persistence-1120`, not mounted".

## New items to register

| Title | Severity | Owner | Target | Status |
|---|---|---|---|---|
| Persistence controls not mounted in the studio | High (demo) | Kilo Code (`main.ts`) | 2026-11-24 | OPEN (handoff ready) |
| Persistence browser tests | Medium | Kilo Code (shared suite), Kiro (cases) | 2026-11-25 | BLOCKED (mounting) |
| Ledger and futures persistence decision | Low | Malak | 2026-11-26 | OPEN (decision) |

## Schedule adjustments (additions only)

| Date | Owner | Task | Depends on |
|---|---|---|---|
| 11-20 | Kiro | Persistence subsystem (this branch) | — |
| 11-21 | Malak | Live Gemini run (WW-025, *existing*, overdue since 11-19); RC approval (WW-030, *existing*) | Key |
| 11-21 | Kiro | Review of Kilo's renderer-futures branch changes to Kiro-owned `src/director/client.ts` | — |
| 11-23 | Kilo | Mount the ledger and futures panels (*proposed 11-20*) | — |
| 11-24 | Kilo | Mount persistence: `boot(host, start)`, `requestReboot`, panel placement | Merge order: RC, then UI branch, then persistence branch |
| 11-24 | Malak | Master Plan v1.2 or approval of a reconstruction; submission format (WW-022, WW-023, *existing*) | — |
| 11-25 | Kilo, Kiro | Persistence browser cases 1 to 7 in the shared suite | Mounting |
| 11-26 | Malak | Real-GPU verification (WW-009, *existing*), now including Save, Reload and Restore | Mounting |
| 11-26 | Malak | Decide whether history (ledger) and futures should survive a reload | — |
| 11-28 | Kiro | *(existing WW-016 target)* Close WW-016 if the browser cases pass; otherwise fix | 11-25 |
| 11-29 | Kiro, Kilo | Full regression including persistence (*proposed 11-20*) | — |
| 11-30 | Kiro | Security review (*proposed 11-20*) now includes import fuzzing with the oversized, deeply nested, prototype-key and API-key-like cases | — |
| 12-01 | Malak, Kiro | Demo video (*proposed 11-20*): include Save, Reload, Restore and Import of an exported world | — |
| 12-03 | Malak | Final submission (*existing*) | — |

## Risks

- **Shared machine:** while Kiro worked on 11-20, Kilo Code was running
  Playwright from `WORLDWEAVER-INTEGRATION-1120`. A Playwright worker was also
  running from `WORLDWEAVER-RC` (Kiro's audit worktree, not started by
  Kiro), and free memory was about 0.8 GB of 7.9 GB. Kiro ran no browser
  tests and ran unit tests one file at a time. One unit run stalled under
  that load and passed when re-run individually.
- **localStorage is per browser profile.** Clearing site data deletes the
  saves, so the UI should encourage Export for anything important.
