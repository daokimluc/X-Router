import { describe, expect, it } from "vitest";
import {
  modelGroupOf,
  matchesGroups,
  expandModelGroups,
  modelsForPlanGroups,
  freeModels,
  ALL_GROUPS
} from "../marketplace/utils/modelGroup.js";

describe("modelGroup expansion (group -> members)", () => {
  it("classifies canonical models into the right groups", () => {
    const g = expandModelGroups(["claude-opus-4-8", "claude-sonnet-4-6", "gpt-5.5", "gemini-2.5-pro"]);
    expect(g.claude.sort()).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
    expect(g.codex).toEqual(["gpt-5.5"]);
    expect(g.gemini).toEqual(["gemini-2.5-pro"]);
    expect(g.other).toEqual([]);
  });

  it("always seeds the free group from the curated set, even with no free canonical", () => {
    const g = expandModelGroups(["claude-opus-4-8"]); // no free model in input
    expect(g.free.length).toBeGreaterThan(0);
    expect(g.free.sort()).toEqual(freeModels().sort());
  });

  it("returns every group label (empty arrays for absent groups)", () => {
    const g = expandModelGroups([]);
    for (const label of ALL_GROUPS) expect(g[label]).toBeDefined();
    expect(g.claude).toEqual([]);
    // free is still populated from the curated set
    expect(g.free.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated members", () => {
    const g = expandModelGroups(["claude-opus-4-8", "claude-opus-4-8"]);
    expect(g.claude).toEqual(["claude-opus-4-8"]);
  });

  it("classifies unknown models as other", () => {
    expect(modelGroupOf("some-weird-model")).toBe("other");
    const g = expandModelGroups(["some-weird-model"]);
    expect(g.other).toEqual(["some-weird-model"]);
  });
});

describe("modelsForPlanGroups", () => {
  const members = expandModelGroups(["claude-opus-4-8", "claude-sonnet-4-6", "gpt-5.5", "gemini-2.5-pro"]);

  it("returns ['*'] verbatim for a grant-all plan", () => {
    expect(modelsForPlanGroups(["*"], members)).toEqual(["*"]);
  });

  it("expands a single-group plan to that group's members", () => {
    expect(modelsForPlanGroups(["claude"], members).sort()).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("unions members across multiple granted groups", () => {
    const out = modelsForPlanGroups(["codex", "gemini"], members).sort();
    expect(out).toEqual(["gemini-2.5-pro", "gpt-5.5"]);
  });

  it("a free plan expands to the curated free models (never empty)", () => {
    const out = modelsForPlanGroups(["free"], members);
    expect(out.sort()).toEqual(freeModels().sort());
    expect(out.length).toBeGreaterThan(0);
  });

  it("an entry that is not a known group is treated as a literal model name", () => {
    // "nope" isn't a group key → kept verbatim as a model (admins may list a
    // model name directly in modelGroups).
    expect(modelsForPlanGroups(["nope"], members)).toEqual(["nope"]);
  });

  it("treats a specific model name in modelGroups as a literal member", () => {
    // Admins sometimes put model names (not group labels) in a plan's modelGroups.
    const out = modelsForPlanGroups(["claude-opus-4-8", "claude-sonnet-4-6"], members).sort();
    expect(out).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("mixes group labels and literal model names", () => {
    const out = modelsForPlanGroups(["codex", "claude-opus-4-8"], members).sort();
    expect(out).toEqual(["claude-opus-4-8", "gpt-5.5"]);
  });
});

describe("matchesGroups accepts group labels AND literal model names", () => {
  it("matches by group label", () => {
    expect(matchesGroups("claude", ["claude"], "claude-opus-4-8")).toBe(true);
  });
  it("matches by literal model name when plan lists models not groups", () => {
    // plan.modelGroups = specific models; the model's group is "claude" which is
    // NOT in the list, but the literal model name IS → must match.
    expect(matchesGroups("claude", ["claude-opus-4-8", "claude-sonnet-4-6"], "claude-opus-4-8")).toBe(true);
  });
  it("rejects a model neither by group nor literal name", () => {
    expect(matchesGroups("gemini", ["claude-opus-4-8"], "gemini-2.5-pro")).toBe(false);
  });
  it("'*' matches everything", () => {
    expect(matchesGroups("anything", ["*"], "whatever")).toBe(true);
  });
});
