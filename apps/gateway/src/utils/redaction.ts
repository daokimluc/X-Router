const sensitiveKeys = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
  "accesskey",
  "accesstoken",
  "refreshtoken",
  "session",
  "sessioncookie",
  "sessionid",
  "token",
  "providertoken",
  // Added for provider-add-account feature
  "mocktoken",
  "code",
  "codeverifier",
]);

const redacted = "[REDACTED]";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.toLowerCase()) || sensitiveKeys.has(normalizeKey(key));
}

export function redactValue(key: string, value: unknown): unknown {
  return isSensitiveKey(key) ? redacted : value;
}

export function redactObject<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item)) as T;
  }

  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      output[key] = isSensitiveKey(key) ? redacted : redactObject(value);
    }

    return output as T;
  }

  return input;
}
