import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // Outside Next.js, importing `server-only` throws. Resolve it to the same empty
      // module Next.js uses under the react-server condition, so every server file
      // keeps its guard (SEC-01).
      "server-only": fromRoot("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    // Suites share one test database and the seed suite truncates it, so files run one at a time.
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
