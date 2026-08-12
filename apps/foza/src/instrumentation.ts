/**
 * Next.js instrumentation hook — runs once when a Node.js server instance boots.
 * Used to start the background reconcile scheduler (the webhook-stream backstop;
 * see lib/xrouter/reconcile-scheduler.ts). Gated to the Node runtime: the
 * scheduler uses timers + SQLite and must never load on the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReconcileScheduler } = await import(
      "@/lib/xrouter/reconcile-scheduler"
    );
    startReconcileScheduler();
  }
}
