import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServer, type Server } from "node:http";

const config = loadConfig();
const app = await buildApp(config);
let kiroCallbackBridge: Server | undefined;
let codexCallbackBridge: Server | undefined;

const close = async (): Promise<void> => {
  app.log.info("shutting down");
  await new Promise<void>((resolve) => {
    let pending = 0;
    if (kiroCallbackBridge) { pending++; kiroCallbackBridge.close(() => { if (--pending === 0) resolve(); }); }
    if (codexCallbackBridge) { pending++; codexCallbackBridge.close(() => { if (--pending === 0) resolve(); }); }
    if (pending === 0) resolve();
  });
  await app.close();
};

process.on("SIGTERM", () => {
  close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

process.on("SIGINT", () => {
  close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

await app.listen({
  host: config.host,
  port: config.port
});

if (config.nodeEnv !== "test") {
  kiroCallbackBridge = createServer((request, response) => {
    const target = new URL("/oauth/callback", `http://127.0.0.1:${config.port}`);
    const incoming = new URL(request.url ?? "/", "http://localhost:3128");

    target.search = incoming.search;
    response.statusCode = 302;
    response.setHeader("location", target.toString());
    response.end("Redirecting to gateway OAuth callback");
  });

  kiroCallbackBridge.on("error", (error: NodeJS.ErrnoException) => {
    app.log.warn(
      {
        err: error,
        port: 3128
      },
      "Kiro OAuth callback bridge could not start"
    );
  });

  kiroCallbackBridge.listen(3128, "127.0.0.1", () => {
    app.log.info(
      {
        port: 3128
      },
      "Kiro OAuth callback bridge listening"
    );
  });

  // Codex OAuth callback bridge on port 1455 (matches OpenAI registered redirect URI)
  codexCallbackBridge = createServer((request, response) => {
    const target = new URL("/oauth/callback", `http://127.0.0.1:${config.port}`);
    const incoming = new URL(request.url ?? "/", "http://localhost:1455");

    // Accept both /callback and /auth/callback
    if (incoming.pathname !== "/callback" && incoming.pathname !== "/auth/callback") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    target.search = incoming.search;
    response.statusCode = 302;
    response.setHeader("location", target.toString());
    response.end("Redirecting to gateway OAuth callback");
  });

  codexCallbackBridge.on("error", (error: NodeJS.ErrnoException) => {
    app.log.warn({ err: error, port: 1455 }, "Codex OAuth callback bridge could not start");
  });

  codexCallbackBridge.listen(1455, "127.0.0.1", () => {
    app.log.info({ port: 1455 }, "Codex OAuth callback bridge listening");
  });

  // Background token refresh for OAuth accounts (every 5 minutes)
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(async () => {
    const accounts = app.providerRuntimeRegistry.listAccounts();
    for (const account of accounts) {
      if (account.status !== "active") continue;
      const secret = app.secretService.getSecretForAccount(account.id);
      if (!secret) continue;
      const cred = app.secretService.decryptSecretPayload(secret);
      if (!cred.expiresAt) continue;
      // Refresh if within 5 minutes of expiry
      const expiresAt = new Date(cred.expiresAt as string).getTime();
      if (expiresAt - Date.now() > REFRESH_INTERVAL_MS) continue;
      // Find adapter and refresh
      const instance = app.providerRuntimeRegistry.getProviderInstance(account.providerInstanceId);
      if (!instance) continue;
      const adapter = app.providerRegistry.getAdapter(instance.type);
      if (!adapter.refreshSession) continue;
      try {
        const result = await adapter.refreshSession(account, { providerInstance: instance, credentialPayload: cred });
        if (result.refreshed && result.credentialPayload) {
          app.secretService.addCredentialPayload({
            id: secret.id,
            accountId: account.id,
            credentialType: "oauth",
            credentialPayload: result.credentialPayload,
          });
          app.log.info({ accountId: account.id }, "Background token refresh succeeded");
        }
      } catch (err) {
        app.log.warn({ accountId: account.id, err }, "Background token refresh failed");
      }
    }
  }, REFRESH_INTERVAL_MS);
}
