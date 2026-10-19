import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("the six governance workstreams use persisted records, enforced gates and source-linked results", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Quality, connected." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bring your projects into one view." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/governance-empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore sample workspace" }).click();
  await expect(page.locator(".gc-stat").first()).toContainText("33%");
  await expect(page.locator(".gc-filter-count")).toHaveText("18 submissions");
  await page.reload();
  await expect(page.locator(".gc-filter-count")).toHaveText("18 submissions");
  await page.screenshot({
    path: "test-results/governance-overview.png",
    fullPage: true,
  });

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Audits & observations" })
    .click();
  await page.getByRole("button", { name: "Run monthly audit" }).click();
  await expect(
    page
      .getByRole("heading", { name: "Submission check:", exact: false })
      .first(),
  ).toBeVisible();
  const first = await (await page.request.get("/api/control/snapshot")).json();
  expect(first.audits).toHaveLength(2);
  expect(first.findings.length).toBeGreaterThan(0);
  expect(
    first.audits.every((a: { adoptionRate: number }) => a.adoptionRate === 60),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Run monthly audit" }).click();
  const second = await (await page.request.get("/api/control/snapshot")).json();
  expect(second.findings).toHaveLength(first.findings.length);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Evidence pack" }).first().click();
  const pack = JSON.parse(
    await readFile((await (await pendingDownload).path())!, "utf8"),
  );
  expect(pack.audit.snapshotHash).toHaveLength(64);
  expect(pack.status).toContain("Draft evidence pack");
  expect(pack.audit.accessSnapshots).toHaveLength(5);
  await page
    .getByRole("button", { name: "Issue observation", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare NCR draft" }),
  ).toBeDisabled();

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Submission gates", exact: true })
    .click();
  await expect(
    page.getByText(
      "Workspace gate enforced · native Asite enforcement pending",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit through gate" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Add submission", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Project", { exact: true })
    .selectOption("demo-project-1");
  for (const [label, value] of Object.entries({
    "Submission title": "Browser verified submission",
    "Document number": "QA-TEST-001",
    Revision: "P01",
    Classification: "Design",
    Discipline: "ARC",
    "Project suitability code": "PROJECT-REVIEW",
  }))
    await dialog.getByLabel(label, { exact: true }).fill(value);
  for (const label of ["design check", "benchmark check", "coordination check"])
    await dialog.getByLabel(label, { exact: true }).check();
  await dialog
    .getByLabel("checklist HTTPS source link")
    .fill("https://cde.example/checklist");
  await dialog
    .getByLabel("benchmark HTTPS source link")
    .fill("https://cde.example/benchmark");
  await dialog
    .getByLabel("Evidence revision", { exact: true })
    .nth(0)
    .fill("P01");
  await dialog
    .getByLabel("Evidence revision", { exact: true })
    .nth(1)
    .fill("P01");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "QA-TEST-001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit through gate" }),
  ).toBeDisabled();
  const after = await (await page.request.get("/api/control/snapshot")).json();
  const submitted = after.submissions.find(
    (s: { documentNo: string }) => s.documentNo === "QA-TEST-001",
  );
  const bypass = await page.request.post(
    `/api/control/submissions/${submitted.id}/submit`,
    {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: { reviewerId: "forged" },
    },
  );
  expect(bypass.status()).toBe(409);
  const csrf = await page.request.post("/api/control/demo", {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  expect(
    (await page.request.post("/api/control/cron", { data: {} })).status(),
  ).toBe(401);

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Lessons learned", exact: true })
    .click();
  await page
    .getByLabel("Ask the lessons assistant")
    .fill("facade brackets coordination");
  await page.getByRole("button", { name: "Find lessons" }).click();
  await expect(page.locator(".gc-answer")).toContainText("Source excerpts");
  await expect(page.locator(".gc-citations a").first()).toBeVisible();
  const source = await page.request.get(
    (await page.locator(".gc-citations a").first().getAttribute("href"))!,
  );
  expect(await source.text()).toContain("FICTIONAL TRAINING CASE");
  await page.screenshot({
    path: "test-results/governance-lessons.png",
    fullPage: true,
  });
  await page.getByLabel("Filter by entity").selectOption("demo-entity-1");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Risk & technical links", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recommend relevant lessons" })
    .click();
  await expect(page.locator(".gc-recommendations")).toBeVisible();
  await page
    .getByRole("button", { name: "Link lesson", exact: true })
    .first()
    .click();
  await expect(page.locator(".gc-linked-lessons")).not.toBeEmpty();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Access & adoption", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Asite access roster", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".gc-table-wrap").first().locator("tbody tr"),
  ).toHaveCount(5);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Information compliance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Versioned rule profiles", exact: true }),
  ).toBeVisible();
  const csv = await page.request.get(
    "/api/control/export?table=submissions&entity=demo-entity-1",
  );
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("gatePassed");
  expect(await csv.text()).not.toContain("DEMO-2-");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Workspace setup", exact: true })
    .click();
  await expect(
    page.getByText("Tenant setup required", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Workspace setup", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/governance-mobile.png",
    fullPage: true,
  });
  expect(crashes).toEqual([]);
});
