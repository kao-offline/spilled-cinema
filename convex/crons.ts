import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "clean up expired capability ticket audit",
  { hours: 6 },
  internal.controlPlane.cleanupCapabilityTicketAudit,
  {},
);

export default crons;
