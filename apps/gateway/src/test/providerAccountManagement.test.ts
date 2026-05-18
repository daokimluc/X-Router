import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const AUTH_HEADER = { authorization: "Bearer admin-key-1" };

describe("Provider Account Management API (/admin/provider-accounts)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /admin/provider-accounts", () => {
    it("returns 400 when provider type does not exist in registry", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "nonexistent_provider",
          displayName: "Test Account",
          credentials: { apiKey: "sk-test-key-1234567890" },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("invalid_provider_type");
      expect(body.error.message).toContain("nonexistent_provider");
      expect(body.error.message).toContain("not found in registry");
    });

    it("returns 400 with field-level errors when required credential fields are missing", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const openaiDef = definitions.find((d) => d.type === "openai");

      // Skip if openai provider not registered
      if (!openaiDef) return;

      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "openai",
          displayName: "Test OpenAI",
          credentials: {}, // Missing required apiKey
        },
      });

      // Should return 400 if credentialSchema has required fields
      if (
        openaiDef.credentialSchema &&
        (openaiDef.credentialSchema as { required?: string[] }).required?.length
      ) {
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.code).toBe("credential_validation_failed");
        expect(body.error.details).toBeDefined();
        expect(Array.isArray(body.error.details)).toBe(true);
        expect(body.error.details.length).toBeGreaterThan(0);
        expect(body.error.details[0].field).toBeDefined();
        expect(body.error.details[0].message).toBeDefined();
      }
    });

    it("creates account and runs health check with valid provider type", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");

      if (!mockDef) return;

      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "Test Mock Account",
          credentials: { mockToken: "test-token" },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.accountId).toBeDefined();
      expect(body.data.providerType).toBe("mock");
      expect(body.data.displayName).toBe("Test Mock Account");
      expect(body.data.healthCheck).toBeDefined();
      expect(body.data.healthCheck.status).toBeDefined();
    });

    it("returns 201 and includes health check result with ok status for mock", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");

      if (!mockDef) return;

      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "Health Check Test",
          credentials: {},
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.healthCheck).toBeDefined();
      expect(body.data.healthCheck.status).toBe("ok");
    });

    it("requires admin authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        payload: {
          providerType: "mock",
          displayName: "No Auth",
          credentials: {},
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 400 for invalid request payload", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          // Missing required providerType and displayName
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("invalid_request_payload");
    });
  });

  describe("GET /admin/provider-accounts", () => {
    it("returns list of accounts", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("does not include credentials in response", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");
      if (!mockDef) return;

      // Create an account with credentials
      await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "Credential Test",
          credentials: { secretKey: "super-secret-value" },
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const responseStr = JSON.stringify(body);
      expect(responseStr).not.toContain("super-secret-value");
      expect(responseStr).not.toContain("secretKey");
    });

    it("requires admin authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/provider-accounts",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("PATCH /admin/provider-accounts/:accountId", () => {
    it("returns 404 when account does not exist", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/admin/provider-accounts/nonexistent-account",
        headers: AUTH_HEADER,
        payload: {
          displayName: "Updated Name",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("account_not_found");
    });

    it("updates account display name", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");
      if (!mockDef) return;

      // Create account first
      const createResponse = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "Original Name",
          credentials: {},
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const accountId = createResponse.json().data.accountId;

      // Update it
      const response = await app.inject({
        method: "PATCH",
        url: `/admin/provider-accounts/${accountId}`,
        headers: AUTH_HEADER,
        payload: {
          displayName: "Updated Name",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.displayName).toBe("Updated Name");
    });

    it("re-runs health check when credentials are updated", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");
      if (!mockDef) return;

      // Create account first
      const createResponse = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "Health Recheck",
          credentials: {},
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const accountId = createResponse.json().data.accountId;

      // Update credentials
      const response = await app.inject({
        method: "PATCH",
        url: `/admin/provider-accounts/${accountId}`,
        headers: AUTH_HEADER,
        payload: {
          credentials: { apiKey: "new-key-value-12345" },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.healthCheck).toBeDefined();
      expect(body.data.healthCheck.status).toBeDefined();
    });

    it("requires admin authentication", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/admin/provider-accounts/some-id",
        payload: { displayName: "test" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("DELETE /admin/provider-accounts/:accountId", () => {
    it("returns 404 when account does not exist", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/admin/provider-accounts/nonexistent-account",
        headers: AUTH_HEADER,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("account_not_found");
    });

    it("deletes account and returns 204", async () => {
      const definitions = app.providerRegistry.listProviderTypes();
      const mockDef = definitions.find((d) => d.type === "mock");
      if (!mockDef) return;

      // Create account first
      const createResponse = await app.inject({
        method: "POST",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
        payload: {
          providerType: "mock",
          displayName: "To Delete",
          credentials: {},
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const accountId = createResponse.json().data.accountId;

      // Delete it
      const response = await app.inject({
        method: "DELETE",
        url: `/admin/provider-accounts/${accountId}`,
        headers: AUTH_HEADER,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone from the list
      const getResponse = await app.inject({
        method: "GET",
        url: "/admin/provider-accounts",
        headers: AUTH_HEADER,
      });

      const accounts = getResponse.json().data;
      const found = accounts.find(
        (a: { accountId: string }) => a.accountId === accountId
      );
      expect(found).toBeUndefined();
    });

    it("requires admin authentication", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/admin/provider-accounts/some-id",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
