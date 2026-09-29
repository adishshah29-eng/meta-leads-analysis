/**
 * POST /api/leads/fetch — manual "Sync leads" button on the Leads page.
 * Same logic as the nightly cron. Optional ?days=N (default 7, max 90).
 */

export { POST } from "@/app/api/cron/sync-leads/route";

// Route segment config must be declared statically in this file
export const maxDuration = 300;
