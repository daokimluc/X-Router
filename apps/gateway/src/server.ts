import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServer, type Server } from "node:http";

const config = loadConfig();
const app = await buildApp(config);
let kiroCallbackBridge: Server | undefined;

const close = async (): Promise<void> => {
  app.log.info("shutting down");
  await new Promise<void>((resolve) => {
    if (!kiroCallbackBridge) {
      resolve();
      return;
    }

    kiroCallbackBridge.close(() => resolve());
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
}
