import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@graph-engineering/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@graph-engineering/persistence": fileURLToPath(
        new URL("../persistence/src/index.ts", import.meta.url),
      ),
      "@graph-engineering/runtime": fileURLToPath(
        new URL("../runtime/src/index.ts", import.meta.url),
      ),
    },
  },
});
