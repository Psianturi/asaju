import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "path";

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
    },
  },
  test: {
    environment: "node",
    // Kilo keeps git worktrees under .kilo/; without this, vitest picks up the
    // duplicate test files in each worktree and double-counts the suite.
    exclude: ["**/node_modules/**", "**/dist/**", ".kilo/**"],
  },
});
