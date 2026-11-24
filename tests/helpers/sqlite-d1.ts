type SqlValue = string | number | bigint | null | Uint8Array;
type Row = Record<string, SqlValue>;
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: SqlValue[]): { changes: number | bigint };
    get(...values: SqlValue[]): Row | undefined;
    all(...values: SqlValue[]): Row[];
  };
  close(): void;
}

/** Node 内置 SQLite 适配成 D1 接口：真实约束 + 原子 batch（沿用 boardroom 测试惯例）。 */
export function builtin<T>(name: string): T {
  return (globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } })
    .process.getBuiltinModule(name) as T;
}
const { DatabaseSync } = builtin<{ DatabaseSync: new (path: string) => SqliteDatabase }>("node:sqlite");

export class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }

  async batch(statements: SqliteStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

class SqliteStatement {
  private values: SqlValue[] = [];
  constructor(private db: SqliteD1, private sql: string) {}

  bind(...values: SqlValue[]): this {
    this.values = values;
    return this;
  }

  private compile() {
    const values: SqlValue[] = [];
    const sql = this.sql.replace(/\?(\d+)/g, (_, index: string) => {
      values.push(this.values[Number(index) - 1]!);
      return "?";
    });
    return { statement: this.db.sqlite.prepare(sql), values };
  }

  runSync() {
    const { statement, values } = this.compile();
    if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(this.sql)) {
      return { success: true, results: statement.all(...values), meta: { changes: 0 } };
    }
    return { success: true, results: [], meta: { changes: Number(statement.run(...values).changes) } };
  }

  async run() { return this.runSync(); }
  async first<T = Row>(): Promise<T | null> {
    const { statement, values } = this.compile();
    return (statement.get(...values) as T | undefined) ?? null;
  }
  async all<T = Row>(): Promise<{ results: T[]; success: true }> {
    const { statement, values } = this.compile();
    return { results: statement.all(...values) as T[], success: true };
  }
}
