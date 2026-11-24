export type DbValue = string | number | boolean | null | Uint8Array;

export interface DbRunResult {
  changes: number;
}

export interface DbQueryResult<T> {
  results: T[];
}

/**
 * 数据库驱动契约：业务层只依赖这里，不直接依赖 D1、SQLite 或任何云厂商类型。
 * 当前实现是 Cloudflare D1 适配器；测试或后续部署可替换为其它实现。
 */
export interface DbStatement<Row = Record<string, unknown>> {
  bind(...values: DbValue[]): DbStatement<Row>;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<DbQueryResult<T>>;
  run(): Promise<DbRunResult>;
}

export interface Database {
  prepare<Row = Record<string, unknown>>(sql: string): DbStatement<Row>;
  batch(statements: DbStatement<unknown>[]): Promise<DbRunResult[]>;
}
