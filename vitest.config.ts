import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node:sqlite prints an experimental warning on every run; it is expected.
    env: { NODE_NO_WARNINGS: "1" },
  },
});
