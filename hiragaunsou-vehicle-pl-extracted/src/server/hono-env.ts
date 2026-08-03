import type { AuthEnv, Auth } from "./auth";

export type Session = Awaited<ReturnType<Auth["api"]["getSession"]>>;

/** Hono の Bindings/Variables 共通定義。c.get("session")/c.set("session", ...) の型を通す */
export type AppEnv = {
  Bindings: AuthEnv;
  Variables: {
    session: Session;
  };
};
