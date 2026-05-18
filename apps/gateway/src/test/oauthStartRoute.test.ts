import { describe, expect, it, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import { clearPendingOAuthStates, getPendingOAuthStates } from "../providers/adapters/oauth-pkce/OAuthPKCECallbackHandler.js";

const adminHeaders = {
  authorization: "Bearer admin-key-1"
};

describe("POST /admin/oauth/start", () => {
  afterEach(() => {
    clearPendingOAuthStates();
  });

  it("starts OAuth PKCE flow for claude_code provider", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "claude_code"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toBeDefined();
    expect(body.data.authorizationUrl).toContain("console.anthropic.com/oauth/authorize");
    expect(body.data.state).toBeDefined();
    expect(body.data.state.length).toBeGreaterThan(0);
    expect(body.data.providerType).toBe("claude_code");
    expect(body.data.expiresIn).toBe(600);

    await app.close();
  });

  it("starts OAuth PKCE flow for github_copilot provider", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "github_copilot"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.authorizationUrl).toContain("github.com/login/oauth/authorize");
    expect(body.data.providerType).toBe("github_copilot");

    await app.close();
  });

  it("starts OAuth PKCE flow for cursor provider", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "cursor"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.authorizationUrl).toContain("cursor.sh/oauth/authorize");

    await app.close();
  });

  it("starts OAuth PKCE flow for codex provider", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "codex"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.authorizationUrl).toContain("auth.openai.com/authorize");

    await app.close();
  });

  it("starts OAuth PKCE flow for antigravity provider", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "antigravity"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.authorizationUrl).toContain("antigravity.dev/oauth/authorize");

    await app.close();
  });

  it("stores pending session with codeVerifier in memory", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "claude_code",
        displayName: "My Claude Account"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const state = body.data.state;

    // Verify pending state is stored
    const pendingStates = getPendingOAuthStates();
    expect(pendingStates.has(state)).toBe(true);

    const pending = pendingStates.get(state)!;
    expect(pending.codeVerifier).toBeDefined();
    expect(pending.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pending.providerType).toBe("claude_code");
    expect(pending.accountDraft?.displayName).toBe("My Claude Account");

    await app.close();
  });

  it("returns 400 for unsupported provider type", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "unknown_provider"
      }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("oauth_start_failed");
    expect(body.error.message).toContain("No OAuth configuration found");

    await app.close();
  });

  it("requires admin authentication", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      payload: {
        providerType: "claude_code"
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("passes account draft options to pending state", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "github_copilot",
        displayName: "Work Copilot",
        owner: "team-dev",
        maxConcurrency: 10,
        weight: 2,
        allowedModels: ["gpt-4"],
        tags: ["work"]
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const state = body.data.state;

    const pendingStates = getPendingOAuthStates();
    const pending = pendingStates.get(state)!;
    expect(pending.accountDraft?.displayName).toBe("Work Copilot");
    expect(pending.accountDraft?.owner).toBe("team-dev");
    expect(pending.accountDraft?.maxConcurrency).toBe(10);
    expect(pending.accountDraft?.weight).toBe(2);
    expect(pending.accountDraft?.allowedModels).toEqual(["gpt-4"]);
    expect(pending.accountDraft?.tags).toEqual(["work"]);

    await app.close();
  });

  it("authorization URL includes PKCE parameters", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/admin/oauth/start",
      headers: adminHeaders,
      payload: {
        providerType: "claude_code"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const url = new URL(body.data.authorizationUrl);

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeDefined();
    expect(url.searchParams.get("state")).toBe(body.data.state);
    expect(url.searchParams.get("client_id")).toBeDefined();
    expect(url.searchParams.get("redirect_uri")).toBeDefined();

    await app.close();
  });
});
