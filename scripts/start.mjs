import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env.local")))
  process.loadEnvFile(resolve(root, ".env.local"));
process.env.ECC_DATABASE_PATH = resolve(
  root,
  process.env.ECC_DATABASE_PATH || ".data/ecc.sqlite",
);
process.env.HOSTNAME = process.env.ECC_BIND_HOST || "0.0.0.0";
await import(pathToFileURL(resolve(root, ".next/standalone/server.js")).href);
