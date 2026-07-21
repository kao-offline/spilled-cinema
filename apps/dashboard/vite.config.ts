import { createLogger, defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createDashboardApiPlugin } from "../../packages/node-client/src/vite-plugin";

function createDashboardLogger() {
  const logger = createLogger();
  const warn = logger.warn.bind(logger);
  const warnOnce = logger.warnOnce.bind(logger);
  const isMinifiedDashCommonJsWarning = (message: string) =>
    message.includes("COMMONJS_VARIABLE_IN_ESM") && message.includes("dash.all.min");

  logger.warn = (message, options) => {
    if (!isMinifiedDashCommonJsWarning(message)) warn(message, options);
  };
  logger.warnOnce = (message, options) => {
    if (!isMinifiedDashCommonJsWarning(message)) warnOnce(message, options);
  };

  return logger;
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    // Rolldown prints the entire one-line, minified dash.js bundle for this
    // harmless compatibility warning, which exceeds Vercel's 4 MB log limit.
    // Keep every other build warning visible.
    customLogger: createDashboardLogger(),
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
