/**
 * Team / Workspace service — manages teams that group internal API keys
 * and apply shared rate limits, daily/monthly quotas, allowed models and
 * allowed providers.
 *
 * MVP scope:
 *   - CRUD teams in memory (persisted via PersistenceService)
 *   - Lookup team by id
 *   - Compute effective limits (team policy + per-key limits)
 *
 * Future: roles, member management, billing, OIDC mapping.
 */

import { randomUUID } from "node:crypto";

export type Team = {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
  allowedModels?: string[];
  allowedProviders?: string[];
  rpmLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTeamInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  allowedModels?: string[];
  allowedProviders?: string[];
  rpmLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
};

export type UpdateTeamInput = Partial<CreateTeamInput>;

export class TeamNotFoundError extends Error {
  readonly code = "team_not_found";
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Team ${id} not found`);
    this.name = "TeamNotFoundError";
  }
}

export class TeamService {
  private readonly teams = new Map<string, Team>();

  list(): Team[] {
    return Array.from(this.teams.values()).map((t) => structuredClone(t));
  }

  get(id: string): Team | undefined {
    const team = this.teams.get(id);
    return team ? structuredClone(team) : undefined;
  }

  require(id: string): Team {
    const team = this.teams.get(id);
    if (!team) {
      throw new TeamNotFoundError(id);
    }
    return structuredClone(team);
  }

  create(input: CreateTeamInput): Team {
    const id = `team_${randomUUID().slice(0, 12)}`;
    const now = new Date();
    const team: Team = {
      id,
      name: input.name.trim(),
      description: input.description?.trim(),
      enabled: input.enabled ?? true,
      allowedModels: input.allowedModels,
      allowedProviders: input.allowedProviders,
      rpmLimit: input.rpmLimit,
      dailyLimit: input.dailyLimit,
      monthlyLimit: input.monthlyLimit,
      createdAt: now,
      updatedAt: now,
    };
    this.teams.set(id, team);
    return structuredClone(team);
  }

  update(id: string, patch: UpdateTeamInput): Team {
    const current = this.teams.get(id);
    if (!current) {
      throw new TeamNotFoundError(id);
    }
    const updated: Team = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    };
    this.teams.set(id, updated);
    return structuredClone(updated);
  }

  delete(id: string): Team {
    const team = this.teams.get(id);
    if (!team) {
      throw new TeamNotFoundError(id);
    }
    this.teams.delete(id);
    return structuredClone(team);
  }

  /** Bulk-load teams from persisted state. */
  load(records: Team[]): void {
    this.teams.clear();
    for (const r of records) {
      this.teams.set(r.id, {
        ...r,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
      });
    }
  }
}
