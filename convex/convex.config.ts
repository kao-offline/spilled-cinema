import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();
app.use(migrations as Parameters<typeof app.use>[0]);

export default app;
