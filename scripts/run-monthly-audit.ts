import { getStore } from "../src/lib/governance/store";
import { runAudits, refreshAlerts } from "../src/lib/governance/service";
import type { Actor } from "../src/lib/governance/types";
const entityIds = (process.env.ECC_AUDIT_ENTITIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== "*");
if (!entityIds.length)
  throw new Error(
    "Set ECC_AUDIT_ENTITIES to the entity IDs authorized for monthly audits.",
  );
const actor: Actor = {
  id: "scheduled-audit-service",
  name: "H.O. monthly audit service",
  email: "audits@ecc.invalid",
  grants: entityIds.map((entityId) => ({
    entityId,
    projectIds: ["*"],
    role: "qa_manager",
  })),
};
const store = getStore();
try {
  const audits = runAudits(store, actor, process.argv[2]);
  const alerts = refreshAlerts(store, actor);
  console.log(
    JSON.stringify({
      audits: audits.map((a) => ({
        id: a.id,
        reused: a.reused,
        findings: a.findingCount,
      })),
      alerts: alerts.created,
    }),
  );
} finally {
  store.close();
}
