import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd();
cpSync(
  resolve(root, ".next/static"),
  resolve(root, ".next/standalone/.next/static"),
  { recursive: true },
);
if (existsSync(resolve(root, "public")))
  cpSync(resolve(root, "public"), resolve(root, ".next/standalone/public"), {
    recursive: true,
  });
