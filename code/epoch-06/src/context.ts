// Request-scoped ambient state via AsyncLocalStorage: ids, user, tenant —
// facts that flow across awaits without being hand-passed through every
// function signature. Ambient FACTS only; business data stays explicit.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "./db/schema.ts";

export interface TenantContext {
  id: string;
  slug: string;
  role: Role;
}

export interface RequestContext {
  requestId: string;
  userId?: string;
  tenant?: TenantContext;
}

const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn);

/** Bind a context to the CURRENT async execution (used by the request hook). */
export const enterContext = (ctx: RequestContext): void => als.enterWith(ctx);

export function getContext(): RequestContext {
  const ctx = als.getStore();
  // 🛡️ Throwing beats returning undefined: a missing context must never
  // quietly become an unscoped query.
  if (!ctx) throw new Error("no request context — code path outside runWithContext");
  return ctx;
}

export function getTenant(): TenantContext {
  const { tenant } = getContext();
  if (!tenant) throw new Error("no tenant in context — route missing tenant resolution?");
  return tenant;
}

/** Non-throwing variant for places that must tolerate absence (e.g. logging). */
export const tryGetContext = (): RequestContext | undefined => als.getStore();
