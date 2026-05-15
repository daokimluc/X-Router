import { describe, expect, it } from "vitest";
import { AccountPool } from "../account-pool/AccountPool.js";
import { buildApp } from "../app.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import { testConfig } from "./helpers.js";

const now = new Date("2026-01-01T00:00:00.000Z");

function makeProviderInstance(): ProviderInstance {
  return {
    id: "provider_kiro_main",
    type: "kiro",
    name: "Kiro Main",
    enabled: true,
    config: {},
    defaultTimeoutMs: 30000,
    maxRetries: 1,
    cooldownMs: 60000,
    accountSelectionStrategy: "round_robin",
    maxConcurrentRequests: 20,
    maxConcurrentRequestsPerAccount: 3,
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      cooldownMs: 60000,
      halfOpenMaxRequests: 1
    },
    createdAt: now,
    updatedAt: now
  };
}

function makeAccount(): ProviderAccount {
  return {
    id: "kiro-1",
    providerInstanceId: "provider_kiro_main",
    providerType: "kiro",
    displayName: "Kiro 1",
    status: "active",
    weight: 1,
    maxConcurrency: 1,
    credentialRef: "secret_kiro_1",
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    createdAt: now,
    updatedAt: now
  };
}

describe("Admin API", () => {
  it("requires admin API key", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        type: "authentication_error",
        message: "Missing or invalid admin API key",
        code: "invalid_admin_api_key"
      }
    });

    await app.close();
  });

  it("rejects normal internal API keys for admin endpoints", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("lists registered provider types with admin key", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((item: { type: string }) => item.type)).toEqual([
      "mock",
      "kiro",
      "windsurf"
    ]);

    await app.close();
  });

  it("does not return raw account credential references", async () => {
    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [makeProviderInstance()],
      [
        {
          providerInstanceId: "provider_kiro_main",
          accountPool: new AccountPool([makeAccount()])
        }
      ]
    );
    const app = await buildApp(testConfig(), {
      providerRuntimeRegistry
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/accounts",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      id: "kiro-1",
      credentialRef: "[REDACTED]"
    });
    expect(JSON.stringify(response.json())).not.toContain("secret_kiro_1");

    await app.close();
  });

  it("records audit logs for admin actions", async () => {
    const app = await buildApp(testConfig());

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/admin/v1/provider-instances/provider_kiro_main",
      headers: {
        authorization: "Bearer admin-key-1"
      },
      payload: {
        enabled: false,
        accountSelectionStrategy: "least_busy"
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({
      enabled: false,
      accountSelectionStrategy: "least_busy"
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/admin/v1/audit-logs",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json().data).toEqual([
      expect.objectContaining({
        action: "provider_instance.update",
        targetType: "provider_instance",
        targetId: "provider_kiro_main"
      })
    ]);

    await app.close();
  });

  it("creates API keys that can authenticate gateway requests", async () => {
    const app = await buildApp(testConfig());

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/api-keys",
      headers: {
        authorization: "Bearer admin-key-1"
      },
      payload: {
        owner: "dashboard"
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json();
    expect(created.key).toMatch(/^igw_/);

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/v1/api-keys",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(JSON.stringify(listResponse.json())).not.toContain(created.key);
    expect(listResponse.json().data).toContainEqual(
      expect.objectContaining({
        id: created.id,
        owner: "dashboard",
        enabled: true
      })
    );

    const modelsResponse = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: `Bearer ${created.key}`
      }
    });

    expect(modelsResponse.statusCode).toBe(200);

    const disableResponse = await app.inject({
      method: "POST",
      url: `/admin/v1/api-keys/${created.id}/disable`,
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });
    expect(disableResponse.statusCode).toBe(200);

    const disabledModelsResponse = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: `Bearer ${created.key}`
      }
    });
    expect(disabledModelsResponse.statusCode).toBe(401);

    await app.close();
  });

  it("creates provider instances, accounts, model mappings, and routing profiles", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "4kb" }));
    const headers = {
      authorization: "Bearer admin-key-1"
    };

    const providerResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/provider-instances",
      headers,
      payload: {
        id: "provider_kiro_extra",
        type: "kiro",
        name: "Kiro Extra",
        accountSelectionStrategy: "weighted_round_robin"
      }
    });

    expect(providerResponse.statusCode).toBe(200);

    const accountResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/accounts",
      headers,
      payload: {
        id: "kiro-extra-1",
        providerInstanceId: "provider_kiro_extra",
        displayName: "Kiro Extra 1",
        credentialType: "api_key",
        weight: 2,
        credentialPayload: {
          apiKey: "secret-value"
        }
      }
    });

    expect(accountResponse.statusCode).toBe(200);
    expect(accountResponse.json()).toMatchObject({
      id: "kiro-extra-1",
      credentialRef: "[REDACTED]"
    });
    expect(JSON.stringify(accountResponse.json())).not.toContain("secret-value");

    const secondAccountResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/accounts",
      headers,
      payload: {
        id: "kiro-extra-2",
        providerInstanceId: "provider_kiro_extra",
        displayName: "Kiro Extra 2",
        credentialType: "api_key",
        weight: 1,
        credentialPayload: {
          apiKey: "secret-value-2"
        }
      }
    });

    expect(secondAccountResponse.statusCode).toBe(200);
    const pool = app.providerRuntimeRegistry.getAccountPool("provider_kiro_extra");
    expect([
      pool?.acquire().account.id,
      pool?.acquire().account.id,
      pool?.acquire().account.id
    ]).toEqual(["kiro-extra-1", "kiro-extra-1", "kiro-extra-2"]);

    const modelResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/model-mappings",
      headers,
      payload: {
        id: "model_kiro_extra",
        publicModel: "kiro-extra",
        providerInstanceId: "provider_kiro_extra",
        providerType: "kiro",
        upstreamModel: "sonnet",
        capabilities: ["chat", "streaming"]
      }
    });

    expect(modelResponse.statusCode).toBe(200);

    const profileResponse = await app.inject({
      method: "POST",
      url: "/admin/v1/routing-profiles",
      headers,
      payload: {
        id: "extra",
        displayName: "Extra",
        candidates: ["kiro-extra"],
        requiredCapabilities: ["chat"]
      }
    });

    expect(profileResponse.statusCode).toBe(200);
    expect(app.modelRegistry.get("kiro-extra")).toMatchObject({
      providerInstanceId: "provider_kiro_extra"
    });
    expect(app.routingProfileRegistry.get("extra")).toMatchObject({
      candidates: ["kiro-extra"]
    });

    const modelPatch = await app.inject({
      method: "PATCH",
      url: "/admin/v1/model-mappings/model_kiro_extra",
      headers,
      payload: {
        enabled: false
      }
    });
    expect(modelPatch.statusCode).toBe(200);
    expect(modelPatch.json()).toMatchObject({ enabled: false });

    const profilePatch = await app.inject({
      method: "PATCH",
      url: "/admin/v1/routing-profiles/extra",
      headers,
      payload: {
        displayName: "Extra Updated"
      }
    });
    expect(profilePatch.statusCode).toBe(200);
    expect(profilePatch.json()).toMatchObject({ displayName: "Extra Updated" });

    const credentialRotate = await app.inject({
      method: "POST",
      url: "/admin/v1/accounts/kiro-extra-1/credential",
      headers,
      payload: {
        credentialType: "api_key",
        credentialPayload: {
          apiKey: "rotated-secret"
        }
      }
    });
    expect(credentialRotate.statusCode).toBe(200);
    expect(JSON.stringify(credentialRotate.json())).not.toContain("rotated-secret");

    const deleteAccount = await app.inject({
      method: "DELETE",
      url: "/admin/v1/accounts/kiro-extra-1",
      headers
    });
    expect(deleteAccount.statusCode).toBe(200);
    expect(deleteAccount.json()).toMatchObject({
      id: "kiro-extra-1",
      credentialRef: "[REDACTED]"
    });
    expect(app.providerRuntimeRegistry.getAccountPool("provider_kiro_extra")?.getAccount("kiro-extra-1")).toBeUndefined();
    expect(app.secretService.getSecretForAccount("kiro-extra-1")).toBeUndefined();

    await app.close();
  });
});
