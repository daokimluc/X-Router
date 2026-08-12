// Minimal type declarations for Node's built-in `node:sqlite` (Node 22.5+,
// still marked experimental so @types/node may not ship full types in the
// version this project uses). Covers only the surface foza-persistence uses.
declare module "node:sqlite" {
  type SQLValue = string | number | bigint | null | Uint8Array;

  interface StatementSync {
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLValue[]): unknown;
    all(...params: SQLValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
