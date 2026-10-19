# E1 Studio

One Vercel application for Asite UAE shop drawing registers: connect, automatically extract the E1 schedules, filter the revision dashboard, and download an Excel workbook matching the supplied Book122 layout.

## Use the application

1. Select **Connect Asite** and sign in to Asite UAE, or choose **Host-session key** and enter your existing API session key. No key is embedded in the application.
2. Extraction starts automatically for accessible projects matching the supplied project codes: 377, 378, 379, 381, 382, 383, 384, 385, 386, and 388. If none match, accessible projects are selected. **Update source** lets you change the project selection.
3. The application finds E1 folders and descendants, reads every returned document-list page, downloads the latest `.xlsx` register files, and reads their transaction rows. The explicitly supplied project-388 `09.03.02 (EI) - Shop Drawing Sheet` spelling is recognized. E10 folders, explicit E2 files/sheets, and material submittals are excluded; mixed E1/E2 folders remain eligible for their E1 data.
4. Filter by project, discipline, dashboard row, package, or scope/drawing search. All metrics, charts, tables, and Excel export follow the same filtered records.
5. **Export Excel** creates `REWORK KPI` with the exact 29 template headers, `RAW TRANSACTIONS`, and `NOTES` with calculation definitions and extraction warnings. Incomplete extractions require an explicit review before exporting and are marked PARTIAL.

Local `.xlsx` register upload and a clearly labeled synthetic demo are available in the same application. The uploaded KPI workbook itself has external references to STR/ARCH/MEP registers; it is a template, not the underlying transaction data.

## Calculations and source layouts

A/B count as approvals; C/D count as rejections. Revision buckets display rejections 0–3 and approvals 0–5; all-revision totals include higher revisions. Missing/nonnumeric revisions are never assumed to be revision zero. Unknown codes remain visible for review.

The supplied workbook counts register rows rather than unique document IDs. **Total Planned** counts rows not marked S; **Total submission Rev 0** requires a revision-zero row and a valid submission date; **Total submissions till approval** counts every retained transaction row, including pending/planned rows. Some KPI labels differ from what their source formulas calculate; NOTES explains the exact preserved formulas.

Supported registers have named document/drawing-number, revision, and status columns. The original classic STR/ARCH/MEP layout is also supported: data starts at row 15; B=document number, D=scope, G=revision, H=latest/superseded, M=status, N=submission date. Missing columns, unmapped scopes, unsupported sheets, and invalid dates generate warnings. `.xls`, macros, encrypted workbooks, and oversized workbooks are not supported. Downloads are limited to 25 MB; archive metadata is checked before parsing.

Asite's document listing describes the latest uploaded file revision. Approval history is calculated from the downloaded register's transaction rows, not reconstructed from its latest metadata. Historical transactions absent from the source register cannot be recovered by this calculation.

## Development and validation

Use the existing `/workspace/ASITE` checkout. Cloud tasks are already isolated; do not create another Git worktree unless explicitly requested.

```sh
cd /workspace/ASITE
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Node.js 22 or newer is required. `npm run test:e2e` uses Playwright and system Chromium; set `CHROMIUM_PATH` if Chromium is elsewhere. Browser tests exercise empty/real/demo states, automatic extraction through mocked account responses, filtering, mobile layout, local register imports, and Excel downloads. Unit tests exercise the documented Asite contracts with mocks, pagination, scope enforcement, parser diagnostics, and exported-cell values. Authenticated live account extraction must be validated with the user's account; mock tests do not establish its permissions or session validity.

## Vercel deployment

Import this repository into Vercel using its Next.js preset, or run `vercel deploy --prod` from this directory with an authorized Vercel account. The normal email/password or existing-session-key flow needs **no application environment variables, database, or separate backend**. Users provide their own Asite credentials in the app. Session keys and imported data remain in the current browser tab's memory; reload/disconnect clears them. Passwords are cleared after sign-in. Asite credentials are sent only to fixed UAE endpoints over HTTPS and are never logged or included in exports.

An optional OAuth connection is available if the application owner registers it with Asite and securely configures `ASITE_CLIENT_ID`, `ASITE_CLIENT_SECRET`, and a random 32+ character `SESSION_SECRET` in Vercel. Register `https://YOUR-APP/api/asite/callback` as its callback. OAuth file enumeration is not defined by the certified connector and is deliberately disabled; use a session connection for automatic register extraction. This optional mode is not needed for the requested host-session workflow.

Asite SSO/MFA policies or API entitlements may prevent direct password login; the existing host-session option is available subject to Asite's API session permissions. Browser security does not allow this application's domain to read cookies from an already-open Asite tab.

## API references

- [Asite Open Data API](https://help.asite.com/en/articles/5700569-open-data-api) and its [public API guide](https://adoddleak.asite.com/lnk/pAAq4b4FG9LzAMHejqA6), sections 6.1–6.6 and 6.51: session login, workspaces, folders, document pagination, and downloads.
- [Asite UAE certified connector](https://github.com/microsoft/PowerPlatformConnectors/tree/master/certified-connectors/Asite%20(UAE)): optional OAuth authorization and project/folder contracts.

The application rejects unexpected hosts/redirects and malformed account responses. A failed read stays visible as a warning or error; it is not reported as a complete empty dashboard.

Session folder and document listing explicitly request Asite's documented XML representation. Namespaced XML, single records, repeated records, and known field-casing variants are supported. HTTP-200 API exception envelopes are treated as errors before reading collections. Connection/extraction failures include a safe diagnostic containing the operation, format, status, and fixed schema-field types; credentials, response values, URLs, and unknown key names are never included.

An explicitly empty XML document-list element is treated as an empty page, so an E1 parent without direct documents does not block its descendants. Nonempty text and malformed envelopes remain errors. Each E1 folder is scanned separately; failed folders are named in warnings while readable sibling registers are retained and the export is marked incomplete.
