import { describe, expect, it } from "vitest";
import { modelGroupOf, matchesGroups } from "../marketplace/utils/modelGroup.js";

describe("modelGroupOf", () => {
  it("maps Claude models to claude", () => {
    expect(modelGroupOf("claude-sonnet-4-6")).toBe("claude");
    expect(modelGroupOf("claude-3-5-sonnet")).toBe("claude");
    expect(modelGroupOf("anthropic/claude-opus")).toBe("claude");
  });

  it("maps Codex/GPT models to codex", () => {
    expect(modelGroupOf("gpt-5.5")).toBe("codex");
    expect(modelGroupOf("gpt-4o")).toBe("codex");
    expect(modelGroupOf("codex-mini")).toBe("codex");
    expect(modelGroupOf("o3-mini")).toBe("codex");
  });

  it("maps Gemini models to gemini", () => {
    expect(modelGroupOf("gemini-2.5-pro")).toBe("gemini");
  });

  it("maps curated cheap models to free", () => {
    expect(modelGroupOf("gpt-4o-mini")).toBe("free");
    expect(modelGroupOf("gemini-2.0-flash")).toBe("free");
  });

  it("keeps haiku in the claude group", () => {
    expect(modelGroupOf("claude-3-5-haiku")).toBe("claude");
  });

  it("maps unknown models to other", () => {
    expect(modelGroupOf("some-random-model")).toBe("other");
    expect(modelGroupOf("")).toBe("other");
  });

  it("matchesGroups handles wildcard and membership", () => {
    expect(matchesGroups("claude", ["*"])).toBe(true);
    expect(matchesGroups("codex", ["claude"])).toBe(false);
    expect(matchesGroups("claude", ["claude", "codex"])).toBe(true);
  });
});
