# AI usage

I directed the development of ShiftSwap, provided the organizer's seed data, and requested improvements to the workflows, interface and verification. I used OpenAI Codex and GPT-6 Astra for coding assistance, debugging, testing, documentation and UI polishing, including assistance with the initial implementation.

## Accepted

I accepted a lightweight Node.js/SQLite approach, shared scheduling-rule validation, transactional persistence, eligibility explanations and automated tests. AI assistance also helped improve the calendar, manager approval views, responsive styling and keyboard interactions.

## Changed and refined

During development, the illustrative data was replaced with the organizer's seed. Date handling was aligned with clinic-local time. Refinements addressed person-switching races, request validation, concurrent actions, approval revalidation and database rollback. The final checks included 32 passing tests and verification that SH007's approved assignment and history survived a backend restart.

## Rejected or avoided

I kept the solution within the requested workflow: no login, real-date eligibility cutoffs, map integrations or pending claims counted as assignments. Deployment remains optional.

This submission includes AI-assisted code. I am responsible for the submitted solution and for understanding and explaining its implementation and decisions.

I also used AI to prepare a short project presentation with application screenshots and presenter notes. The presentation summarizes the implemented workflows and verified results.
