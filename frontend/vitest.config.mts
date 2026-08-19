import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests cover the pure logic that decides what the UI says: contract
 * adaptation, error mapping and input validation. Component and flow behaviour
 * is verified by driving the real app against the real API instead — a DOM
 * simulation would only re-assert what the browser already proved.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
