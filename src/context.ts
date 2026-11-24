import type { Env, UserRow } from "./types";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    user: UserRow;
  };
};
