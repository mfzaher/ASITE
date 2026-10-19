# Power BI reporting contract

The starting integration exposes authenticated CSV tables; it does not yet publish a PBIP report or configure an Asite-native report.

## Immediate use

Open **Workspace setup → Reporting tables** in the app. Download a table using your authenticated workspace session, then import it into Power BI. The current entity/project filters apply; monthly audit rows are entity-wide.

| Table | Primary key | Useful relationships / measures |
|---|---|---|
| `submissions` | `id` | `entityId`, `projectId`, revision, status, `gatePassed`, `gateIssueCount`, `ruleVersion`, due date |
| `findings` | `id` | `auditId`, `submissionId`, status, severity, issued/deadline dates |
| `audits` | `id` | Month, entity, source count, conforming count, finding count, expected users, monthly active users, nullable adoption rate and completeness basis |
| `lessons` | `id` | Project, status, source revision and source references |
| `risks` | `id` | Project, likelihood, impact, process and linked lesson IDs |
| `access` | `id` | Entity/project/email, entitlement evidence, latest activity, period activity events and completeness |

Example endpoint: `GET /api/control/export?table=submissions&entity=ENTITY_ID&project=PROJECT_ID`.

For unattended access, create a random 32+ character `ECC_REPORTING_TOKEN` in the approved secret manager and set `ECC_REPORTING_ENTITIES` to an explicit comma-separated list of allowed entity IDs. The service sends `Authorization: Bearer <token>`. It receives read-only access to those entities; wildcard entity scope is rejected. Use an approved Power BI custom connector/gateway credential store for the bearer credential, rather than placing it in shared report code or query-string URLs. HTTPS is required for hosted use.

## Measure definitions

- Local gate compliance = passing submissions / supplied submissions. A zero denominator is unknown, not 100%.
- Current recorded adoption = expected person/project roster entries with activity within the prior 30 days / expected roster entries. This is not a count of unique corporate people across projects.
- Historical monthly adoption is populated only when complete activity histories are supplied for every expected entry. An authoritative period-end roster is required.
- Overdue = draft/unsubmitted record with a recorded due date before observation time. This is a deterministic date rule, not a prediction.
- Audits use source dates to select records and preserve the values observed at audit run time. Full native Asite extraction coverage must be reconciled separately.

Imported arrays such as evidence and lesson IDs are JSON-encoded CSV cells. Normalize them in Power Query if a related evidence/lesson bridge table is needed. Confirm report audience, definitions, data source and refresh scope before publishing.
