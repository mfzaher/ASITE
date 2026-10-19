# Initial verification — 19 October 2026

| Check | Result |
|---|---|
| TypeScript | Passed |
| Unit and integration tests | **84 passed** |
| Browser tests | **7 passed**, including the complete six-workstream walkthrough and preserved register flows |
| Production build | Passed; standalone assets prepared |
| Production smoke test | Passed: startup/assets, real authentication, local-mode bypass disabled, project scope, protected evidence and cron authorization |
| Runtime/source exclusions | Secret files, SQLite databases/sidecars, dependencies, generated builds and browser artifacts excluded from Git |

The governance browser test begins with a fresh isolated database, explicitly loads fictional sample records, verifies persistence after reload, runs and repeats an audit, downloads its evidence snapshot, issues an observation, confirms early NCR escalation is blocked, creates an incomplete-approval submission and verifies a direct API bypass is rejected. It then checks source-linked retrieval, risk linking, access records, scoped CSV exports and mobile overflow. Source examples are fictional throughout.

The integration tests use Better Auth's real database/session implementation. They verify that public signup is disabled, project grants are enforced, and membership revocation affects the next request. Audit tests cover Dubai month boundaries, rejection of an open month, immutable monthly snapshot reuse, the reuse authorization path, missing historical activity, and NCR sequencing.

Live Asite credentials were not available. Native Asite metadata/gates/reports, official NCR release, authenticated account extraction, external notification delivery, live model performance, scheduled hosted execution and Docker execution are not established by these checks. The rollout dependencies are recorded in `PROJECT-PLAN.md`.

Run the commands in the root README to reproduce the checks. GitHub CI is included, with its actions pinned to verified release commit hashes. Monthly scheduled jobs are explicitly gated off until the repository rollout variable and service configuration are supplied.
