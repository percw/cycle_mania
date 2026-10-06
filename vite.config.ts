import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  // The local evaluation archive and agent worktrees contain copies of src; never test them twice.
  test: { exclude: ["**/node_modules/**", "**/dist/**", "evaluation-v2/frozen-build/**", ".claude/**"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
          if (id.includes("/node_modules/react")) return "react";
        },
      },
    },
  },
});
