import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Cross-platform local development launcher. The environment flag is limited
// to this child process; no ECC credentials or production data are loaded.
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(
  process.execPath,
  [nextCli, "dev", "--hostname", "127.0.0.1", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, ECC_LOCAL_MODE: "1" },
  },
);
child.on("error", (error) => {
  console.error("Unable to launch the local ECC workspace:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
