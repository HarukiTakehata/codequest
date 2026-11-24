import type { Database, DbQueryResult, DbRunResult, DbStatement, DbValue } from "./types";

class D1Statement<Row> implements DbStatement<Row> {
  readonly native: D1PreparedStatement;

  constructor(native: D1PreparedStatement) {
    this.native = native;
  }

  bind(...values: DbValue[]): DbStatement<Row> {
    return new D1Statement<Row>(this.native.bind(...values));
  }

  async first<T = Row>(): Promise<T | null> {
    return (await this.native.first<T>()) ?? null;
  }

  async all<T = Row>(): Promise<DbQueryResult<T>> {
    const result = await this.native.all<T>();
    return { results: result.results };
  }

  async run(): Promise<DbRunResult> {
    const result = await this.native.run();
    return { changes: result.meta.changes ?? 0 };
  }
}

export class D1DatabaseAdapter implements Database {
  constructor(private readonly binding: D1Database) {}

  prepare<Row = Record<string, unknown>>(sql: string): DbStatement<Row> {
    return new D1Statement<Row>(this.binding.prepare(sql));
  }

  async batch(statements: DbStatement<unknown>[]): Promise<DbRunResult[]> {
    const natives = statements.map((statement) => {
      if (!(statement instanceof D1Statement)) {
        throw new Error("Cannot batch statements created by a different database adapter");
      }
      return statement.native;
    });
    const results = await this.binding.batch(natives);
    return results.map((result) => ({ changes: result.meta.changes ?? 0 }));
  }
}
