import { LeastBusyStrategy } from "./LeastBusyStrategy.js";
import { LowestCostStrategy } from "./LowestCostStrategy.js";
import { PriorityStrategy } from "./PriorityStrategy.js";
import { RoundRobinStrategy } from "./RoundRobinStrategy.js";
import type { AccountSelectionStrategy } from "./types.js";
import { WeightedRoundRobinStrategy } from "./WeightedRoundRobinStrategy.js";
import type { AccountSelectionStrategy as ProviderAccountSelectionStrategy } from "../providers/base/ProviderInstance.js";

export function createAccountSelectionStrategy(
  strategy: ProviderAccountSelectionStrategy
): AccountSelectionStrategy {
  switch (strategy) {
    case "weighted_round_robin":
      return new WeightedRoundRobinStrategy();
    case "least_busy":
      return new LeastBusyStrategy();
    case "priority":
      return new PriorityStrategy();
    case "lowest_cost":
      return new LowestCostStrategy();
    case "round_robin":
    case "lowest_error_rate":
    case "lowest_latency":
      return new RoundRobinStrategy();
  }
}
