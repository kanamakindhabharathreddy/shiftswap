# ShiftSwap

A full-stack web application for CityCare Clinic. Staff post shifts, colleagues claim them, and managers approve or reject the handover. Assignments change only on approval. Includes the provided organizer seed (10 people, 61 shifts), persistent SQLite storage, eligibility previews, projected weekly hours, and a shared action history.

## Run locally

Requires **Node.js 24 or newer** (uses built-in `node:sqlite`). No npm packages, paid services, API keys, database server or frontend build are required.

```sh
git clone https://github.com/kanamakindhabharathreddy/shiftswap.git shiftswap
cd shiftswap
npm start
```

Open **http://localhost:3000**. Choose a person from the top-right selector. Staff use **My schedule** to post/withdraw shifts and unclaim requests; **Swap board** shows other staff members' open listings with every eligibility reason. Managers use **Approvals** to approve/reject pending claims and **Open board** to inspect shifts waiting for a claimant. Everyone can view **Activity log**.

The weekly calendar shows assigned shifts with certification colors, times and listing status. Previous/Next week also filters the roster below. Click a shift to open its detail dialog and post or withdraw its listing; Escape closes the dialog and returns keyboard focus. The hours panel summarizes the selected week. Overnight shifts and all of their hours belong to their start day/week; “No starts” means no shift starts on that day and does not imply an overnight shift is absent. Weeks without assigned shifts are included. Your pending claims appear above the date-grouped roster. Scheduling rules are available in an expandable panel below each view.

Summary cards and the main navigation action provide shortcuts to the relevant workspace. Notifications can be dismissed. While a person change loads, calendar actions stay disabled. An open detail dialog follows roster updates and closes if its shift is reassigned.

Search by shift ID, staff name or certification, filter by Monday-start week, and sort by start time or duration. Eligible only narrows staff listings; Ready to approve narrows the manager's queue. History supports person, outcome and text filters. Clear filters restores the full view.

Each claim card shows the claimant's current and projected weekly hours. Manager previews show every reason that would currently block approval. These are previews: the server always checks the rules again when the action is submitted. Visible tabs refresh every 10 seconds and on return to the tab. A connection indicator and explicit Refresh control help recover from a disconnected server; requests time out after 10 seconds. Browser storage is used only to remember the selected person.

Person changes take effect only after that person's roster and eligibility load successfully. If the request fails, the previous person's view remains selected, including when you navigate while loading.

```sh
npm test
```

The database is created at `data/shiftswap.sqlite`. `seed.json` is loaded only if no saved state exists. Restarting the server preserves the roster, listings and history. To deliberately start over, stop the server, back up your database, and remove `data/shiftswap.sqlite`. Do not reset during normal use.

Optional environment variables: `PORT` (default 3000), `HOST` (default 127.0.0.1), `DB_PATH` (SQLite file), `SEED_PATH` (initial seed file). For external hosting set HOST=0.0.0.0 and attach persistent storage for DB_PATH. Hosts with ephemeral disks lose changes on redeploy/restart; local execution is the primary supported path.

## Rules and assumptions

- Identity is selected by the user, as specified. This is not an authenticated production application.
- Clinic-local timestamps are parsed into arithmetic coordinates using UTC date methods to avoid host timezone and daylight-saving effects. They do not represent real UTC timestamps. The system clock never determines shift eligibility; all seed shifts are treated as upcoming.
- A week starts Monday at 00:00. The entire duration of an overnight shift is charged to the week in which it starts.
- Overlap uses strict interval comparisons. Exactly 11 hours rest and exactly 40 weekly hours are permitted. Missing certification, each conflicting assignment, and weekly-hour violations are all reported.
- Claiming your own shift returns only rule 1. Claiming a non-OPEN listing returns only `no longer available`. Managers cannot post or claim.
- Pending claims do not count as assignments or reserve weekly hours. On approval, rules 2–5 are checked against current assignments. Failed approval leaves the listing CLAIMED.
- Listing transitions: OPEN → CLAIMED → APPROVED; unclaim/reject returns CLAIMED → OPEN; withdrawal is OPEN → WITHDRAWN. A new listing may be posted after withdrawal or approval by the current owner.
- The server records successful and refused domain actions in history with person, action, shift, outcome and reasons. Malformed HTTP requests are rejected before domain processing and are not history entries. Sequence numbers provide deterministic action ordering; no simulated action clock was specified.
- New history entries also preserve the listing's previous/resulting status and assignment handover. Existing databases from earlier development still load; older entries are explicitly labeled as earlier events without inventing transition details.
- SQLite `BEGIN IMMEDIATE` wraps the latest-state read, validation, mutation and history append. Competing requests cannot both claim the same OPEN listing or approve against stale assignments. A singleton JSON document keeps the implementation small and readable; it is suited to the hackathon roster, not a large production clinic.
- Seed IDs are nonempty strings. Invalid seed structure or an invalid initial roster causes startup to fail explicitly.

## Architecture

- `rules.js`: pure date arithmetic and shared eligibility validation.
- `store.js`: seed validation, transactional state machine and durable history.
- `server.js`: HTTP API and static frontend; validates requests, limits bodies and applies browser security headers.
- `public/`: responsive vanilla JavaScript/CSS interface, no build step. API data is escaped before rendering. `view-model.js` contains pure filtering/sorting helpers.
- `test/`: rule boundaries, overnight/week handling, a 140-case actor/action/status permission matrix, refusal immutability, invalid seed and HTTP inputs, UTF-8 request handling, competing claims and conflicting approvals across two backend processes, restart persistence, organizer seed, hour projections, history context and combined UI filters.

API: `GET /api/state?actor=S1`; `POST /api/actions` with JSON `{ "actor_id": "S1", "action": "post", "target_id": "SH004" }`. Post targets a shift ID; all other actions target a listing ID. Rule refusals return HTTP 409 and all applicable reasons. The server remains authoritative even if the UI was loaded before another user's action; Refresh reloads current state.

Action requests require the `application/json` media type (an optional charset parameter is accepted), nonempty string fields and a body no larger than 16 KiB. Cross-origin browser action requests are refused. Input errors do not change state or add domain history entries.

## Demo walkthrough

This walkthrough assumes a fresh installation using the organizer seed. An existing database retains its earlier swaps; do not reset saved test data to repeat the demo.

1. Select Ben, open My schedule and post SH001 (2 March, 07:00–15:00).
2. Select Uma, open Swap board, and claim SH001.
3. Select Meera, open Approvals and approve the request. SH001 is now assigned to Uma.
4. Open Activity log to inspect all three actions; restart the server to verify persistence.
5. To demonstrate refusal previews, select Asha and post SH004. Ben's Swap board shows the missing ICU certification and insufficient rest before SH007.

To demonstrate approval revalidation with the original seed: Ben posts SH033 and Sana posts SH034 (both Monday 9 March, 07:00–15:00). Uma can claim both while each is pending. A manager approves SH033; Uma now has 40 hours that week. The SH034 approval preview becomes blocked by both overlap and 48 projected weekly hours. Attempting approval returns both reasons and leaves SH034 CLAIMED. Rejecting it returns the listing to OPEN. This is a useful demonstration of why approval must recheck the current roster.

## Requirement coverage

| Requirement | Implementation |
| --- | --- |
| Person selection without login | Staff/manager selector |
| Own shifts, post, withdraw | Staff My schedule |
| Other OPEN listings and all eligibility reasons | Swap board with inline reasons |
| Claim and unclaim | Claim button and Your pending claims |
| Managers approve/reject; approval checks current assignments | Approval desk and transactional rule validation |
| Shared action history including refusals | Activity log with filters and transition details |
| Persistence and seed only on first run | SQLite state and serialized initialization |
| No external services or API keys | Node 24 built-ins only |

## Decisions to explain

The difficult part is the difference between a pending claim and an assignment. Pending claims leave ownership unchanged and do not consume weekly hours. Because another approval may change the roster, a previously valid claim can become invalid. The shared eligibility function handles both claim-time and approval-time checks, and the SQLite transaction ensures the check and assignment update use the same current state. The frontend previews are helpful explanations; they never replace server-side validation.

## Submission

Include README.md and AI_USAGE.md in the final repository. Commit and push everything before your organizer's strict deadline. Optional deployment must use the final commit; do not make commits after the deadline or store the deployment submission link in the repo.
