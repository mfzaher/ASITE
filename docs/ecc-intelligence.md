# ECC Intelligence Assistant

## Entry point

Once the ECC Information Governance application is running, open **/assistant**. Use the **ECC Intelligence** link in the existing left navigation.

The assistant is a read-only, authenticated interface to records already imported into the ECC governance workspace. It is **not** a live Asite API connector or a Microsoft 365 connection.

## Available questions

| Intent | Evidence and response |
| --- | --- |
| Monthly active user ranking | Complete, dated project access-history imports; unique normalized email per project; Dubai month boundaries |
| Users inactive for at least 60 days | Complete activity-history imports; incomplete history is marked unknown, not inactive |
| Open observations | Local finding register; never confused with native Asite forms |
| NCRs | Local NCR drafts only; official issued / closed Asite NCRs are unknown |
| Due submissions | Local workspace submission due dates; not native Asite workflow tasks |
| Project overview | Local submissions, open findings and risks |
| Approved lessons | Only approved cases belonging to the selected projects |
| Drawing approval codes, MIR/WIR, shop drawings and workflows | Explicitly unavailable until authorized Asite feeds exist |
| Other analytical questions | Optional source-grounded AI Gateway answer over bounded local project snapshots |

All metrics are scoped to the authenticated user's allowed projects and exclude fictional sample records. Click **Source records** to review exportable workspace records. Source exports require the same authenticated session.

## Security model

- Business access is controlled by the existing Better Auth workspace and entity/project memberships.
- `POST /api/control/assistant` checks request origin, validates JSON input, and limits queries to 15 per minute per actor.
- Unknown/inaccessible project IDs are rejected. An empty project selection means all projects currently accessible to the user.
- No write tools, direct Asite API calls or arbitrary network URL fetching are exposed.
- External model use is disabled unless the organization approves and configures AI Gateway credentials.
- No samples are treated as ECC operational evidence.
- GitHub source visibility does **not** grant access to the running application, and no confidential data or secrets should be committed to the public repository.

## Run and verify

The existing repository requires **Node.js 24+** and an authenticated persistent SQLite deployment. Follow the root README for provisioning and `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ECC_PUBLIC_ORIGIN`, and `ECC_DATABASE_PATH` requirements.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

For a local, empty test workspace on loopback only:

```bash
npm run dev:demo
```

Only press **Explore sample workspace** when explicitly testing; such samples are excluded from ECC assistant answers.

### Optional model setup

An approved deployment may supply `AI_GATEWAY_API_KEY` and `ECC_AI_MODEL` as server-side secrets to enable model-assisted explanation of scoped governance facts. Use only a model authorized to process the selected ECC data. AI responses carry citations to the workspace exports and warnings that citation ID validation does not prove factual correctness.

Without these environment variables the assistant still answers its supported structured queries through deterministic calculations. Unstructured prompts return a configuration explanation instead of pretending to use an AI model.

## Live Asite prerequisites

Live document counts, A–E approval KPIs, Letters, native workflows and official NCR status require **authorized Asite UAE API access**, project-by-project data retrieval, normalized authoritative records, completeness audits, and source attribution. This assistant does not invent these data points while OAuth is unresolved.

## Release checklist

- [ ] CI typecheck, unit tests, build and browser tests pass.
- [ ] Reviewer verifies RBAC enforcement and expected source exclusions.
- [ ] Server secrets and deployment configuration approved.
- [ ] Confidential ECC data stored only in the approved authenticated environment, not the public repository.
- [ ] Live Asite source completeness validated independently before enabling additional KPI domains.
