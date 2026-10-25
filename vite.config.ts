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
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Libraries that change rarely get their own cacheable chunks; the app
        // chunk then only carries app code. Wallet SDKs stay lazy as before.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "motion";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    // Kilo keeps git worktrees under .kilo/; without this, vitest picks up the
    // duplicate test files in each worktree and double-counts the suite.
    // contracts/ has its own Hardhat runner (`npm test` there).
    exclude: ["**/node_modules/**", "**/dist/**", ".kilo/**", "contracts/**"],
  },
});
