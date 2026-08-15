// Fastify decoration types: one place where the platform's extension points
// meet the type system.
import type { makeTaskRepository } from "./repositories/task-repository.ts";
import type { makeUserRepository } from "./repositories/user-repository.ts";
import type { makeSessionRepository } from "./repositories/session-repository.ts";
import type { makeWorkspaceRepository } from "./repositories/workspace-repository.ts";
import type { TenantContext } from "./context.ts";

declare module "fastify" {
  interface FastifyInstance {
    taskRepository: ReturnType<typeof makeTaskRepository>;
    userRepository: ReturnType<typeof makeUserRepository>;
    sessionRepository: ReturnType<typeof makeSessionRepository>;
    workspaceRepository: ReturnType<typeof makeWorkspaceRepository>;
  }
  interface FastifyRequest {
    user: { id: string } | null;
    tenant: TenantContext | null;
  }
}

export {};
