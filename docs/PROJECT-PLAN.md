# ECC governance programme — working version 0.1

Accountable owner: **M. Zaher**. Started **19 October 2026**. Business timezone: **Asia/Dubai**.

The initial application implements all six workstreams against a persistent local workspace. It preserves the supplied Asite UAE drawing-register integration at `/registers`. It is a starting implementation, not an operational or certified ECC/Asite rollout.

| Workstream | Implemented in this version | Remaining live rollout dependency |
|---|---|---|
| Monthly H.O. adoption audits → observations → official NCRs | Period selection, Dubai cutoffs, source/evidence snapshots and SHA-256 hashes, monthly adoption when complete history is supplied, approved adoption targets, observation issue/deadlines, overdue NCR drafts, closure evidence and a scheduled worker | Confirm period-end roster and activity-history completeness, approved audit procedure, official NCR template and native Asite authorized issue process |
| ISO 19650 metadata, tracking and reports | Versioned project/entity rule profiles, procedure references and approval, required metadata, revision/suitability checks, rule-based overdue alerts and scoped reporting exports | ECC/project information standard, authoritative metadata/status mapping, native Asite report configuration, real extraction coverage; labelled history before any ML predictor |
| Mandatory Asite QA/QC gates | Server-enforced local gate, mandatory digital checklist keys, evidence types, revision matching, independent review, reset approval on edits and direct-API bypass protection | Deploy and verify equivalent checks in native Asite pre-acceptance/workflow gates; validated document/OCR extraction where structured inputs are unavailable |
| Secure lessons-learned hub in the CDE | Persistent source-linked cases and revisions, draft/approval lifecycle, server-side project permissions, keyword retrieval and source excerpts; optional AI Gateway synthesis and embeddings | Approved CDE ingestion/update/deletion connector, model/hosting/data-processing approval and relevance/grounding benchmark |
| Lessons → risk registers and technical processes | 5×5 working risk matrix, process records, scoped keyword/hybrid recommendations, reviewer-visible relevance reasons and explicit lesson links | ECC scoring taxonomy and technical process catalogue; integration into the authoritative risk register and human evaluation of recommendations |
| Asite access across all ECC entities and enforced usage | Expected-user roster, entitlement evidence, current activity metrics, application membership grants/revocation and scoped read-only reporting | Commercial licence agreement, Asite account provisioning/SSO, authoritative entity/project roster and usage policy; application permissions do not grant Asite licences |

## Initial rollout sequence

1. Provision the workspace owner. Create the real ECC entities/projects and map their Asite workspace IDs.
2. Confirm approved project requirements and role matrices. Replace every demonstration profile and sample record; sample loading is only allowed in an empty workspace.
3. Import a small authorized set of normalized submissions, checklists, source evidence and period-end user activity. Reconcile row counts and source coverage with Asite.
4. Have separate author/reviewer accounts exercise the gate. Verify missing evidence, revision changes and direct-API attempts remain blocked.
5. Run a monthly audit and review its frozen JSON evidence pack. Issue observations through the approved communication path; verify response deadlines before drafting NCRs.
6. Publish and evaluate real source-linked lessons. Review risk recommendations for applicability and false matches.
7. Connect the approved Power BI/gateway reporting path. Configure the scheduler only after authenticated hosting, the persistent database and authorized service scope are ready.
8. Configure native Asite metadata/report/gate/NCR workflows in a tenant test project. Reconcile native state with this application before live release.

## Important operating boundaries

- Audit scope is the supplied workspace dataset. It does not prove that every Asite record or missing submission has been extracted. Include the complete expected deliverable population to audit omissions.
- Submission values are observed at audit run time. Source dates select the period; the app does not reconstruct unprovided historical revisions.
- Historical monthly adoption is **unknown** unless every expected roster entry has complete period activity history. Latest-login timestamps alone are insufficient. A period-end roster is required for an authoritative historical denominator.
- Findings capture requirements, observed gaps, source references and rule versions. The workspace does not infer root causes or certify compliance.
- Observation issue is an internal workspace record. No external notification is sent. Official NCR issuance is deliberately left to the authorized ECC/Asite process.
- Gate enforcement is real within this application. Native Asite release is neither performed nor claimed.
- Due-soon/overdue labels are date rules, not trained predictions. No probability estimate is shown without an evaluated model.
- The initial UI supports structured JSON intake. It does not claim to interpret arbitrary PDF drawings, scans or native Asite forms.

## Skills applied

The design uses the downloaded audit/NCR, data-quality, CDE governance, API, authentication, retrieval, risk-register and web-testing skills. The Italian BIM package is background guidance only: its national naming rules, legal references, suitability codes and fixed SLA examples were not adopted as universal ECC/ISO requirements. No hosted Power BI report was published and no Asite configuration was changed.

## Acceptance evidence

Automated checks cover the original register parser/integration contracts, real Better Auth sign-in and membership revocation, project isolation, approved criteria, revision-linked gates, rejected self-approval, audit idempotency, frozen snapshots, Dubai period boundaries, observation/NCR sequencing, atomic imports, historical adoption completeness and source-scoped retrieval. Browser tests exercise the six screens, data persistence, audit pack download, blocked API submission, source links, risk linking, CSV scope and mobile overflow.

Authenticated live Asite extraction, tenant-side enforcement, official NCR release, hosted schedule execution and live model quality still require the integrations and ECC inputs above.
