# ECC — Quality & Information Governance

A working starting project for M. Zaher's six H.O./Asite workstreams: monthly adoption audits, ISO information controls, mandatory QA/QC checks, lessons learned, risk/process linking and access governance. The supplied Asite UAE drawing-register dashboard is preserved at **`/registers`**.

## Run locally

Requires **Node.js 24+**.

```sh
npm ci
npm run dev:demo
```

Open `http://localhost:3000`. The database starts empty. **Explore sample workspace** explicitly loads fictional examples across all six workstreams. Single-user development mode is restricted to loopback hosts and disabled in production. Use it for local development, not company data or shared hosting.

For authenticated use, provision the owner account and then start normally:

```sh
read -r -s -p 'Workspace owner password (12+ characters): ' ECC_SETUP_PASSWORD
printf '%s' "$ECC_SETUP_PASSWORD" | npm run setup -- --email owner@your-company.com --password-stdin
unset ECC_SETUP_PASSWORD
npm run dev
```

Setup generates `.env.local` secrets without printing them. Public signup is disabled. Run the same setup command for additional accounts; an administrator must grant each account entity/project membership in **Access & adoption**. The first account receives workspace administration. Existing accounts/passwords are never silently replaced.

## Implemented workflows

| Workstream | Working behavior |
|---|---|
| Monthly H.O. audits | Dubai cutoffs, repeat-safe monthly runs, frozen evidence snapshots, monthly adoption with complete activity history, approved usage targets, observation deadlines, overdue NCR drafts, closure evidence and JSON evidence packs |
| Information compliance | Versioned project rules, approval references, mandatory metadata, project-defined suitability codes, CSV exports and date-based alerts |
| QA/QC gates | Server-enforced local gate, digital checklists, matching evidence revisions, independent reviewer approval and approval reset on edits |
| Lessons hub | Source-linked cases/revisions, draft approval, project-scoped retrieval, source excerpts and optional grounded AI/semantic retrieval |
| Risk/process links | Technical process records, working 5×5 scoring, relevant-lesson recommendations and explicit lesson links |
| Access/adoption | Expected person/project roster, entitlement evidence, measured activity, application roles and immediate membership revocation |

Start in **Workspace setup**. Create entities/projects, configure and approve criteria in **Information compliance**, then import source records. The import dialog supplies JSON templates and validates the entire batch before saving. External approvals are not inferred: submissions need an independent workspace review.

### Live rollout dependencies

The app enforces its own gates; native Asite gates/reports and official NCR release require tenant configuration. Observation issue is recorded locally and sends no external notification. The register studio can use your own Asite UAE account/session, but it does not automatically populate every governance checklist, expected deliverable or activity history. Reconcile normalized intake with authoritative sources.

Commercial entitlement and account provisioning remain Asite administrative actions. Date-based alerts are not trained predictions. Optional AI remains off until approved model IDs and credentials are configured. No certification, complete CDE extraction or production rollout is claimed.

## Monthly automation

The worker is **`POST /api/control/cron`**, authenticated with `Authorization: Bearer <ECC_CRON_SECRET>`. Set explicit `ECC_AUDIT_ENTITIES`; wildcard entity scope is rejected. It audits the previous Dubai month, refreshes local alerts and prepares NCR drafts only for overdue issued observations. It never issues official NCRs.

The GitHub workflow schedules **09:15 Asia/Dubai on the first day of each month**. Scheduled jobs remain skipped until repository variable **`ECC_AUDIT_ENABLED=true`** is set. Configure repository secrets `ECC_AUDIT_URL` (the HTTPS worker endpoint) and `ECC_CRON_SECRET` after authenticated hosting and persistence are ready. Manual dispatch is supported.

```sh
ECC_AUDIT_ENTITIES=entity-id-1,entity-id-2 npm run audit:once
# Optional explicit audit period:
ECC_AUDIT_ENTITIES=entity-id-1 npm run audit:once -- 2026-09
```

## Persistence and hosting

SQLite defaults to `.data/ecc.sqlite`; configure `ECC_DATABASE_PATH` for a persistent volume. Use an authenticated Node.js host and HTTPS. After owner setup, set `BETTER_AUTH_URL` and `ECC_PUBLIC_ORIGIN` to the public HTTPS origin:

```sh
npm run build
npm start
```

`Dockerfile` and `compose.yml` describe a self-hosted layout using `.data/` and `.env.local`; container execution is not part of current verification. Ephemeral/serverless filesystems do not provide durable SQLite persistence. The retained Vercel configuration belongs to the supplied register app; replace the database adapter with an approved durable service before deploying the governance workspace there.

## Optional integrations

- **Power BI:** authenticated CSV exports work immediately. Scoped unattended refresh uses `ECC_REPORTING_TOKEN` and `ECC_REPORTING_ENTITIES`. See [reporting contract](integrations/powerbi/README.md).
- **AI Gateway:** configure `AI_GATEWAY_API_KEY`, approved `ECC_AI_MODEL` and optionally `ECC_EMBEDDING_MODEL`. Only permitted approved lessons are sent to the provider. Failures return labelled source excerpts.
- **Asite:** the retained register studio supports the documented UAE session flow and optional registered OAuth configuration. See [register studio documentation](docs/register-studio.md).

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser checks use system Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`). Use a fresh `ECC_DATABASE_PATH`: the governance browser test starts with an empty workspace and explicitly loads samples. Tests do not establish live Asite access, native tenant enforcement, model quality or hosted schedule execution.

See [PROJECT-PLAN.md](docs/PROJECT-PLAN.md) for the six-workstream scope and rollout sequence, and [DATA-AND-SECURITY.md](docs/DATA-AND-SECURITY.md) for data and permission boundaries.
