import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/cli.ts",
  platform: "node",
  external: [/^node:/, "commander", "p-limit", "picocolors", "ssh2"],
  output: {
    file: "dist/cli.js",
    format: "esm",
    banner: "#!/usr/bin/env node",
    sourcemap: false,
  },
});
