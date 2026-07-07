import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const assets = [
  ["src/agent-targets.json", "dist/agent-targets.json"],
];

for (const [source, destination] of assets) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(process.cwd(), source), join(process.cwd(), destination));
}
