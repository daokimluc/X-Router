/**
 * ModelPricingService — per-model token pricing for cost accounting.
 *
 * Stores input/output/cached token rates per model and calculates
 * estimated cost in USD for each request. Inspired by new-api's
 * ratio/pricing system.
 */

export type ModelPricing = {
  model: string;
  /** Cost per 1M input tokens (USD) */
  inputRate: number;
  /** Cost per 1M output tokens (USD) */
  outputRate: number;
  /** Cost per 1M cached input tokens (USD). Defaults to inputRate * 0.5 if unset. */
  cachedInputRate?: number;
  /** Optional display label */
  label?: string;
  updatedAt: Date;
};

export type CostCalculation = {
  promptCost: number;
  completionCost: number;
  cachedCost: number;
  totalCost: number;
};

/**
 * Default pricing for well-known models (USD per 1M tokens).
 * These are approximate and should be updated via admin API.
 */
const DEFAULT_PRICING: Array<Omit<ModelPricing, "updatedAt">> = [
  // OpenAI
  { model: "gpt-4o", inputRate: 2.5, outputRate: 10, cachedInputRate: 1.25 },
  { model: "gpt-4o-mini", inputRate: 0.15, outputRate: 0.6, cachedInputRate: 0.075 },
  { model: "gpt-4-turbo", inputRate: 10, outputRate: 30 },
  { model: "o3-mini", inputRate: 1.1, outputRate: 4.4, cachedInputRate: 0.55 },
  // Anthropic
  { model: "claude-3-5-sonnet", inputRate: 3, outputRate: 15, cachedInputRate: 0.3 },
  { model: "claude-3-5-sonnet-latest", inputRate: 3, outputRate: 15, cachedInputRate: 0.3 },
  { model: "claude-sonnet-4", inputRate: 3, outputRate: 15, cachedInputRate: 0.3 },
  { model: "claude-3-5-haiku", inputRate: 0.8, outputRate: 4, cachedInputRate: 0.08 },
  { model: "claude-3-opus", inputRate: 15, outputRate: 75, cachedInputRate: 1.5 },
  // DeepSeek
  { model: "deepseek-chat", inputRate: 0.14, outputRate: 0.28, cachedInputRate: 0.014 },
  { model: "deepseek-reasoner", inputRate: 0.55, outputRate: 2.19, cachedInputRate: 0.055 },
  // Gemini
  { model: "gemini-2.0-flash", inputRate: 0.1, outputRate: 0.4, cachedInputRate: 0.025 },
  { model: "gemini-2.5-pro", inputRate: 1.25, outputRate: 10, cachedInputRate: 0.315 },
  // Groq
  { model: "llama-3.3-70b", inputRate: 0.59, outputRate: 0.79 },
  // Mistral
  { model: "mistral-large", inputRate: 2, outputRate: 6 },
];

export class ModelPricingService {
  private readonly pricing = new Map<string, ModelPricing>();

  constructor(loadDefaults = true) {
    if (loadDefaults) {
      for (const p of DEFAULT_PRICING) {
        this.pricing.set(p.model, { ...p, updatedAt: new Date() });
      }
    }
  }

  /** Upsert pricing for a model. */
  set(input: Omit<ModelPricing, "updatedAt">): ModelPricing {
    const entry: ModelPricing = { ...input, updatedAt: new Date() };
    this.pricing.set(input.model, entry);
    return structuredClone(entry);
  }

  /** Get pricing for a specific model. Falls back to prefix match. */
  get(model: string): ModelPricing | undefined {
    // Exact match first
    const exact = this.pricing.get(model);
    if (exact) return structuredClone(exact);

    // Prefix match: "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet"
    for (const [key, value] of this.pricing) {
      if (model.startsWith(key)) return structuredClone(value);
    }

    return undefined;
  }

  /** List all configured pricing entries. */
  list(): ModelPricing[] {
    return Array.from(this.pricing.values()).map((p) => structuredClone(p));
  }

  /** Delete pricing for a model. */
  delete(model: string): boolean {
    return this.pricing.delete(model);
  }

  /**
   * Calculate cost for a request.
   * Returns cost in USD. Returns 0 if no pricing is configured for the model.
   */
  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0
  ): CostCalculation {
    const pricing = this.get(model);
    if (!pricing) {
      return { promptCost: 0, completionCost: 0, cachedCost: 0, totalCost: 0 };
    }

    const cachedRate = pricing.cachedInputRate ?? pricing.inputRate * 0.5;
    const nonCachedPrompt = Math.max(0, promptTokens - cachedTokens);

    const promptCost = (nonCachedPrompt / 1_000_000) * pricing.inputRate;
    const completionCost = (completionTokens / 1_000_000) * pricing.outputRate;
    const cachedCost = (cachedTokens / 1_000_000) * cachedRate;
    const totalCost = promptCost + completionCost + cachedCost;

    return {
      promptCost: round6(promptCost),
      completionCost: round6(completionCost),
      cachedCost: round6(cachedCost),
      totalCost: round6(totalCost),
    };
  }

  /** Load pricing from persisted state. */
  load(entries: ModelPricing[]): void {
    this.pricing.clear();
    for (const entry of entries) {
      this.pricing.set(entry.model, {
        ...entry,
        updatedAt: new Date(entry.updatedAt),
      });
    }
  }

  /** Export all entries for persistence. */
  export(): ModelPricing[] {
    return Array.from(this.pricing.values());
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
