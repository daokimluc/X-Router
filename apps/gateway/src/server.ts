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
}

