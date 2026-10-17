import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router and Tailwind plugins stay out of tests.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
