import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "supabase/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
