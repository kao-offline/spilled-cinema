import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createDashboardApiPlugin } from "../../packages/node-client/src/vite-plugin";

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      watch: {
        ignored: ["**/.spilledcinema/**", "**/downloads/**", "**/dist/**"],
      },
    },
    plugins: [react(), tailwindcss(), createDashboardApiPlugin()],
  };
});
