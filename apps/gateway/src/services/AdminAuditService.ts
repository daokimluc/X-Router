export type AuditLogEntry = {
  id: string;
  action: string;
  actorKeyHash?: string;
  targetType?: string;
  targetId?: string;
  createdAt: string;
};

export class AdminAuditService {
  private readonly entries: AuditLogEntry[] = [];

  record(entry: Omit<AuditLogEntry, "id" | "createdAt">): AuditLogEntry {
    const logEntry: AuditLogEntry = {
      id: `audit_${this.entries.length + 1}`,
      createdAt: new Date().toISOString(),
      ...entry
    };

    this.entries.push(logEntry);
    return structuredClone(logEntry);
  }

  list(): AuditLogEntry[] {
    return this.entries.map((entry) => structuredClone(entry));
  }
}

