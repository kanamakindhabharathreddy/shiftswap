# Final ShiftSwap requirement check

Checked on 10 October 2026 against both pages of the original ShiftSwap problem PDF and the supplied SHiftSwap_seed.json. The PDF supplied the acceptance criteria; its submission instructions were not treated as authorization to publish or send anything.

Result: the required application behavior passes the checks below. The submission statuses record this audit before publication. No commit or push was made during the audit itself.

## Data and scheduling rules

| Requirement | Evidence | Result |
| --- | --- | --- |
| Web UI and backend | Node HTTP server serves the browser interface and state/action APIs; real HTTP tests exercise them. | PASS |
| Use the supplied people and roster | Repository seed is byte-for-byte identical to the organizer file; tests load 10 people and 61 shifts. | PASS |
| Initialize only when there is no saved state | Transactional initialization checks the SQLite state row before reading seed. Reopening with a missing or empty seed preserves saved data. | PASS |
| Clinic-local minute timestamps; no timezone/DST conversion | Strict parsing in rules.js uses UTC methods only for arithmetic; UI formatting explicitly uses UTC for the same local coordinates. | PASS |
| Overnight shifts | Duration, rest checks and UI end-date labels support midnight crossings. Sunday overnight tests charge the entire duration to its start week. | PASS |
| Every shift is upcoming | Scheduling and UI actions never compare shift times with the current clock. March seed shifts remain actionable in October. | PASS |
| Strict overlap definition | Interval comparisons in rules.js match the specification. Touching shifts avoid the overlap rule but still fail the rest rule. | PASS |
| Monday-start weeks; full duration assigned to start week | weekStart and weeklyImpact, Monday boundary and Sunday overnight tests. | PASS |
| Original owner stays assigned until approval | Workflow tests and durable reads after post/claim verify unchanged assignments. | PASS |
| Pending claims do not consume assigned hours | Multiple pending claims can independently pass; subsequent approval tests detect the changed roster. | PASS |
| Rule 1: own shifts cannot be claimed; report only that rule | Own-shift test combines other violations and receives only rule 1. | PASS |
| Rule 2: required certification | Server eligibility checks and combined-refusal tests; organizer roster validation. | PASS |
| Rule 3: no assigned overlap | Overlap tests identify the conflicting shift; approval revalidation and competing approvals also exercise it. | PASS |
| Rule 4: at least 11 hours from every nonoverlapping assignment | Tests pass at exactly 11 hours in both directions and fail one minute below; each conflicting shift is identified. | PASS |
| Rule 5: at most 40 assigned hours including the proposed shift | Tests pass exactly 40 hours, fail 40 hours plus one minute, and exclude other weeks. | PASS |
| Non-OPEN claims return only the availability refusal | State/permission matrix and simultaneous-claim tests verify the exact message and unchanged claimant. | PASS |
| Otherwise report every violated rule | Combined test receives rules 2, 3, 4 and 5 together, including both relevant conflict IDs; UI renders every reason. | PASS |
| Approval rechecks rules 2–5 using current assignments | Same eligibility function is rerun inside the write transaction; tests cover new overlap, rest and weekly-hours violations. | PASS |
| Refused approval remains CLAIMED with original assignment | Revalidation tests and refusal-immutability matrix. | PASS |

## Actions, roles and required views

| Requirement | Evidence | Result |
| --- | --- | --- |
| Select staff or manager without login | Person selector; identity and eligibility update together after a successful load. | PASS |
| Managers have no shifts and cannot post/claim | Seed validation, server role checks and permission matrix; manager navigation exposes approval/open-board views. | PASS |
| Only managers approve/reject | Permission matrix verifies every actor against every listing status. | PASS |
| Owner posts only when no OPEN/CLAIMED listing exists | Server state machine, duplicate-post tests and cross-process simultaneous posting. | PASS |
| Poster withdraws only OPEN listings to WITHDRAWN | Permission matrix, state-transition tests and prior browser walkthrough. | PASS |
| Other eligible staff claim OPEN listings to CLAIMED | Rule/workflow tests, real HTTP claims and prior browser walkthrough. | PASS |
| Claimer unclaims only CLAIMED listings to OPEN | State-transition and permission tests; prior browser walkthrough. | PASS |
| Approval assigns claimant and closes listing as APPROVED | Workflow, persistence and competing-approval tests; live SH007 evidence below. | PASS |
| Rejection reopens CLAIMED listing without reassignment | Transition tests, history handover test and prior browser walkthrough. | PASS |
| At most one active listing per shift | Transactions, permission tests and 2,000-action independent invariant check. | PASS |
| Staff see own assigned shifts and their active listing statuses | My schedule, weekly calendar, roster and pending-claims section; inspected frontend and prior browser checks. | PASS |
| Staff see colleagues' OPEN listings and eligibility/reasons | Swap board excludes own listings and renders all server reasons with eligible claim controls. | PASS |
| Managers see CLAIMED listings and approve/reject controls | Approvals queue uses CLAIMED listings and current server previews. | PASS |
| Everyone sees who acted, action, shift and outcome | Shared Activity log includes success/refusal reasons. Final browser check displayed events #18/#19 without errors. | PASS |
| Saved state survives backend restart | Real live restart and automated process/store recreation tests; see PERSISTENCE_AUDIT.md. | PASS |

## Final evidence

- Fresh `npm test`: **32 passed, 0 failed, 0 skipped**. Includes a 140-case role/action/status matrix, actual HTTP process restart, two processes sharing one database, seed independence, and rollback under a forced database write failure.
- Independent simulation: **2,000 actions passed** certification, rest/overlap, weekly hours, active-listing uniqueness, ownership, claimant-role, refusal-immutability and history checks. Uses an isolated in-memory copy of the organizer seed.
- Current live SQLite `integrity_check`: **ok**. All 61 current assignments pass eligibility. Replaying the 19 saved events reproduces the actual assignments and listings.
- The live state matches both the current API and the complete snapshot taken before the earlier real backend restart. It still contains **10 people, 61 shifts, 8 listings and 19 events**.
- **SH007 belongs to Vikram (S8)**. Listing **l10 remains APPROVED**. Event **#18** is Vikram's successful claim, OPEN to CLAIMED; event **#19** is Meera's successful approval, CLAIMED to APPROVED, Ben to Vikram.
- Unchanged saved payload SHA-256: `a241f715890f0e033304f0d1eb58b5b1ac057457b1030974f70205f9f3e2cbd6`.
- Organizer/repository seed SHA-256: `91164a6c90242547f3681b791533dcecc02d6a3f7ed1cffa62145b4a70d23f2c`.
- Clean extracted source package: all 32 tests pass; all JavaScript syntax checks pass; starting with `npm start` serves the frontend, scripts, CSS and all 61 initial shifts using a separate database. The archive matches the repository source and excludes runtime storage, Git metadata and temporary QA tools.

The earlier browser verification exercised every action, failed approval, eligibility reasons, actor-load failures and phone layouts using a separate backend. This final pass rechecked the visible live history and found no browser warnings/errors. It did not repeat every UI mutation against the live database.

## Submission checks

| Requirement | Status |
| --- | --- |
| Runs locally without paid services or keys | PASS: Node 24 built-ins, no npm dependencies or external frontend assets. |
| Code, seed, tests, README and AI_USAGE included | PASS: all present in the source package. README explains setup, assumptions and architecture; AI_USAGE records accepted, changed and rejected AI work. |
| No runtime state accidentally submitted | PASS: data/, .env and node_modules are ignored; source archive excludes them. The existing demo database remains on this computer. |
| Accessible GitHub repository and submitted link | Pre-push audit status: publication was pending. After publication, verify organizer access and submit through the designated channel. |
| Deadline/no late commits | Requires the organizer's actual start/end time; the PDF gives a duration, not the event's observed start. No commits have been made by this audit. |
| Optional deployment | Not performed; not required for the application checks. It must use the final commit and durable storage if persistence is expected on the host. No deployment submission link is in the repository. |
| Any event-specific additional requirements | No additional requirements were supplied in this conversation; cannot verify announcements made outside it. |
| Individual work and ability to explain code | Candidate responsibility. AI assistance is documented; no other candidates were contacted. The audit cannot certify the candidate's independent understanding. |

## Files and changes

Inspected: the original problem PDF and seed; package.json, .gitignore, rules.js, store.js, server.js, public/index.html, public/app.js, public/view-model.js; all four test files; README.md, AI_USAGE.md, VERIFICATION.md and PERSISTENCE_AUDIT.md; live SQLite state, restart evidence, Git status and source package.

This final pass changed only documentation: two outdated README navigation labels and a fresh-installation demo clarification; AI_USAGE and verification notes; this checklist. The source archive was refreshed. No application code, UI styling or existing saved state was changed. No new scheduling defects were found.

Known verification limits: the first four historical events predate enriched transition fields, although they retain the required person/action/shift/outcome and their actions replay consistently. Physical power-loss/disk-failure testing and external deployment were not performed; transaction rollback and backend restart were tested. GitHub access/submission remain to be verified after pushing.
