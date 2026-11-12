import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app's vite.config.ts also registers the local sign-in route. Tests do
// not start that server. They import the same source files through Vite so
// TypeScript and the path aliases match the browser build.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
