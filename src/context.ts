import type { Database } from "./db";
import type { Env, UserRow } from "./types";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    user: UserRow;
    db: Database;
  };
};
