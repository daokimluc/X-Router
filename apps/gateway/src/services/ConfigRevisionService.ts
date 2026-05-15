import { randomUUID } from "node:crypto";

export type ConfigRevision = {
  id: string;
  version: number;
  config: Record<string, unknown>;
  createdAt: Date;
  publishedAt: Date;
  actorKeyHash?: string;
};

export class ConfigRevisionService {
  private currentConfig: Record<string, unknown>;
  private readonly revisions: ConfigRevision[] = [];

  constructor(
    initialConfig: Record<string, unknown> = {},
    initialRevisions: ConfigRevision[] = []
  ) {
    this.currentConfig = structuredClone(initialConfig);
    this.revisions.push(...initialRevisions.map((revision) => structuredClone(revision)));
  }

  getCurrent(): Record<string, unknown> {
    return structuredClone(this.currentConfig);
  }

  listRevisions(): ConfigRevision[] {
    return this.revisions.map((revision) => ({
      ...revision,
      config: structuredClone(revision.config)
    }));
  }

  validateDraft(config: Record<string, unknown>): { valid: true } {
    structuredClone(config);
    return { valid: true };
  }

  publish(
    config: Record<string, unknown>,
    actorKeyHash?: string
  ): ConfigRevision {
    this.validateDraft(config);

    const revision: ConfigRevision = {
      id: `config_rev_${randomUUID()}`,
      version: this.revisions.length + 1,
      config: structuredClone(config),
      createdAt: new Date(),
      publishedAt: new Date(),
      actorKeyHash
    };

    this.revisions.push(revision);
    this.currentConfig = structuredClone(config);
    return {
      ...revision,
      config: structuredClone(revision.config)
    };
  }

  rollback(revisionId: string, actorKeyHash?: string): ConfigRevision {
    const target = this.revisions.find((revision) => revision.id === revisionId);

    if (!target) {
      throw new ConfigRevisionNotFoundError(revisionId);
    }

    return this.publish(target.config, actorKeyHash);
  }
}

export class ConfigRevisionNotFoundError extends Error {
  readonly code = "config_revision_not_found";

  constructor(revisionId: string) {
    super(`Config revision ${revisionId} not found`);
    this.name = "ConfigRevisionNotFoundError";
  }
}
