# ShiftSwap verification

Verified on 10 October 2026 with Node.js 24.16.0.

## Astra review

GPT-6 Astra independently reviewed the original problem statement, organizer seed, implementation and tests. It fixed an identity-switch race in the frontend and strengthened JSON request parsing, byte-based body limits and Unicode handling.

`npm test` passes **32 tests** after the persistence audit. The suite includes a **140-case actor/action/listing-status matrix**, exact 11-hour and 40-hour boundaries, combined refusal reasons, approval revalidation, invalid requests/seeds, cross-process competing claims/approvals, first-run initialization and restart persistence. Weekly planner tests cover Sunday overnight attribution, quiet weeks and agreement with roster filtering. The two additional persistence tests verify immediate durable writes, seed independence and atomic rollback under a forced storage failure. JavaScript syntax checks pass.

The existing live SH007 handover was verified directly from SQLite and the API before/after a real backend restart with `npm start`: Vikram retained the assignment, listing l10 remained APPROVED and events #18/#19 survived unchanged. See PERSISTENCE_AUDIT.md for the full evidence and limitations.

## Astra UI refinement

The refined interface includes an interactive weekly workload planner, roster rows grouped by date, role-aware navigation, a dedicated manager approval queue, clearer assignment handovers and responsive layouts.

Browser verification of this version used a separate in-memory backend:

- Selecting a week showed exactly the matching assigned shifts.
- Post, claim, unclaim, withdraw, approve and reject completed through the interface.
- Certification and both rest violations appeared together for an ineligible claimant; the claim button remained disabled.
- Pending claims showed the original owner. Approval recorded the owner handover in history.
- A second pending claim became blocked after another approval. Both overlap and weekly-hours reasons remained visible; rechecking refused approval without changing its status. Rejection returned it to the open board.
- The manager's Ready to approve filter excluded blocked claims; the activity outcome filter isolated the refusal and its reasons.
- Desktop and mobile layouts were visually inspected, with no page-level horizontal overflow at 390px and 320px widths. No browser console errors were recorded during these checks.

The normal demo database was preserved.

## Calendar redesign verification

The final design uses a dark workspace rail, indigo/lime colors, clickable summaries, a weekly shift calendar, hours/activity context, dismissible notices and native shift-detail dialogs. Astra independently reviewed the new interaction code; the findings were fixed before completion.

- Calendar Previous/Next navigation filtered the roster correctly and moved focus to the calendar heading at the first/last week.
- Posting, withdrawing and reposting worked from the shift dialog. Closing with Escape returned focus to its current calendar trigger.
- A delayed person switch disabled previous-person calendar controls until the new identity loaded.
- A background approval reassigned a shift and closed its obsolete open dialog, with focus restored to the page heading.
- An empty roster rendered an explicit empty state without console errors.
- Overnight events exposed the full end date in their accessible name and displayed the next-day marker. Empty day cells use “No starts,” with a start-day attribution note.
- Claim/unclaim, manager rejection, open-board navigation and notification dismissal completed through the final interface.
- The calendar and dialog were visually checked at 390px; the manager/staff views had no page overflow at 390px and 320px. The existing 30-test suite continued to pass.

These mutation checks used a separate in-memory backend. No new UI actions were applied to the normal demo database during this pass.

## Independent application checks

- 2,000 deterministic simulated domain actions preserved certification, rest, overlap, weekly hours, listing uniqueness, ownership, claimant roles and audit completeness. Every refusal preserved the prior domain state. This supplemental check used an in-memory copy of the official seed.
- Browser: post, withdraw, repost, claim, unclaim, reject and approve all completed successfully. Pending claims left the assignment unchanged. Approval changed the assignment and recorded the handover in history.
- Browser fault test: a three-second delayed actor switch retained the previous identity and eligibility while navigation remained usable. A deliberate HTTP 503 left that prior view intact. A delayed successful response updated identity and eligibility together.
- Browser: certification and multiple rest violations appeared together; the weekly-hours projection showed the exact 40-hour boundary correctly.
- Prior browser checks also covered combined overlap/weekly-hours refusal during approval, preserved CLAIMED status after refusal, search/week/history filters, and desktop/mobile layout.

The fault tests used a separate temporary backend and local proxy. The user's normal demo database was not reset or used for these mutations. Test proxy code is development-only and is excluded from the submission archive.

## Seed and package

The repository seed matches the organizer's supplied file byte-for-byte. SHA-256:

`91164a6c90242547f3681b791533dcecc02d6a3f7ed1cffa62145b4a70d23f2c`

The source archive excludes `.git`, runtime database files and temporary QA infrastructure. It contains the application, organizer seed, tests, README and AI_USAGE. The final archive is checked by extracting it into a clean directory, running its test suite and starting the extracted application with a temporary database.

## Scope

The final requirement-by-requirement audit is in FINAL_REQUIREMENT_CHECK.md. It rechecks the original statement, current saved state and source-package readiness, and explicitly lists the remaining publication/submission steps.

No known scheduling-rule defects remain from these checks. This is a local hackathon implementation with the requested person selector rather than authentication, a SQLite state document suitable for the provided roster, and periodic browser refresh. GitHub publication and optional deployment are separate submission steps.
