import { handlers } from "@/auth";

// Auth.js mounts its endpoints (signin, callback, session, csrf, signout…)
// under /api/auth/*. Excluded from the proxy matcher (api routes are skipped).
export const { GET, POST } = handlers;
