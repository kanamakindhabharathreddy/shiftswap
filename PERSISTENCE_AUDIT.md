# Persistence audit

Verified on 10 October 2026 against the existing live database, using Node.js 24.16.0. **Result: passed.** No application/UI code changed, no test data was reset, and no Git commit was created.

## Storage and startup

This checkout uses a vanilla JavaScript frontend and Node HTTP backend; no React/TypeScript project was found here. `server.js` uses `createStore` with the default database `data/shiftswap.sqlite`. The frontend retrieves state from the API; browser storage remembers only the selected person.

`store.js` stores staff, shifts (including `assigned_to`), listings and history together in the SQLite `state` table's single JSON row. Startup enters `BEGIN IMMEDIATE`, checks for that saved row, and reads/validates the seed only when the row does not exist. Saved state takes precedence even if the seed is missing or has changed. The supplied seed still matches the organizer's file byte-for-byte.

Every completed domain action reads current state, validates it, changes the assignment/listing if allowed, appends history, updates the row and commits within one transaction. A response indicating success occurs only after commit. Refused domain operations preserve staff/shifts/listings and append a refusal event; malformed HTTP requests do not enter the store or append history. Exceptions roll back the transaction.

There is no manually overwritten JSON file or partial multi-file save. SQLite's rollback journal provides atomic writes. The inspected database uses DELETE journal mode and the default FULL synchronous level. `BEGIN IMMEDIATE` serializes updates and initialization across backend processes; the configured busy timeout is 5 seconds. The existing two-process tests verify competing posts, claims and approvals against one database.

## Live SH007 check and restart

Before restart, the API and a direct read-only database inspection matched. A SQLite backup was saved separately under the workspace's `work/` directory before stopping the backend.

The verified backend process was stopped, then restarted from the existing project directory with **`npm start`**. This tested an actual process restart, not just a refreshed browser or a reconstructed fixture.

| Check | Before restart | After restart |
| --- | --- | --- |
| SH007 assignment | S8 — Vikram | S8 — Vikram |
| Listing l10 | APPROVED; poster S2, claimant S8 | Identical |
| Event #18 | S8 claimed SH007; OPEN → CLAIMED | Identical |
| Event #19 | M1 (Meera) approved SH007; CLAIMED → APPROVED; S2 → S8 | Identical |
| Staff / shifts / listings / history | 10 / 61 / 8 / 19 | 10 / 61 / 8 / 19 |
| SQLite integrity check | ok | ok |

The complete API response and complete stored state matched exactly across restart. The saved JSON payload's SHA-256 was unchanged:

`a241f715890f0e033304f0d1eb58b5b1ac057457b1030974f70205f9f3e2cbd6`

All 61 current assignments passed certification, overlap, rest and weekly-hours checks. IDs were unique; active listings were unique per shift. Replaying all 19 successful events from the organizer roster produced the current assignments and listings. The first four legacy events do not contain the newer explicit transition/handover fields; their actions were replayed, but absent metadata cannot be independently verified. Events #18 and #19 contain the full fields.

## Automated tests

`npm test`: **32 passed, 0 failed**. This includes the original 30 tests and two new tests in `test/persistence.test.js`:

1. Post, claim and approval are independently readable from disk immediately after each action and before store closure. Reopening with a missing seed preserves all saved fields. Reopening with an empty seed preserves state and a persisted refusal.
2. A temporary SQLite trigger forces an approval write failure. Assignment, listing and history remain exactly unchanged. After removing the fault, approval succeeds, proving rollback released the transaction; reopening preserves the result.

The existing HTTP test restarts a real backend process and verifies state/history. The existing two-process test covers initialization and competing updates. The remaining suite covers permissions, refusal immutability, invalid requests/seeds, approval revalidation and scheduling boundaries. The new test file also passes `node --check`.

All automated mutations used temporary databases. The live database received no audit actions.

## Files and limits

Inspected: `package.json`, `server.js`, `store.js`, `rules.js`, `seed.json`, `public/app.js`, `.gitignore`, README, existing tests and the SQLite database. Changed: added `test/persistence.test.js` and this report; updated verification/AI-usage documentation and refreshed the source archive. No frontend or backend implementation change was needed.

No persistence defect was found by these checks. Hardware power loss, disk-full failures and external hosting were not tested. Deployment must keep DB_PATH on persistent storage; an ephemeral hosting disk cannot preserve data across redeployment. The restarted local backend remains running on port 3000.
