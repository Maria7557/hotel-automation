import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const serverRoot = resolve(import.meta.dirname, "..");

await rm(resolve(serverRoot, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [resolve(serverRoot, "src/index.ts")],
  outfile: resolve(serverRoot, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  packages: "external",
  alias: {
    "@hotel/contracts": resolve(serverRoot, "../../packages/contracts/src/index.ts"),
    "@hotel/domain": resolve(serverRoot, "../../packages/domain/src/index.ts"),
    "@hotel/templates": resolve(serverRoot, "../../packages/templates/src/index.ts"),
  },
  logLevel: "info",
});
