import type { Database } from "./types";
import { D1DatabaseAdapter } from "./d1";

export type { Database, DbQueryResult, DbRunResult, DbStatement, DbValue } from "./types";

/** 把部署环境提供的 D1 binding 包装成业务层依赖的数据库契约。 */
export function createDatabase(binding: D1Database): Database {
  return new D1DatabaseAdapter(binding);
}
