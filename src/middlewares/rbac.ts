import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { AppError } from './errorHandler.js';
import type { WorkspaceMembership, WorkspaceRole } from '../generated/prisma/client.js';

const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireWorkspaceRole; null outside rbac-guarded routes. */
    membership: WorkspaceMembership | null;
  }
}

/**
 * preHandler factory enforcing a minimum workspace role (roles are ranked:
 * OWNER > EDITOR > VIEWER). Expects `authenticate` to have run and the route
 * to declare a `:workspaceId` param. Non-members receive 404 rather than 403
 * so the response does not reveal that the workspace exists.
 */
export function requireWorkspaceRole(minRole: WorkspaceRole) {
  return async function workspaceRoleGuard(request: FastifyRequest): Promise<void> {
    if (!request.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { workspaceId } = request.params as { workspaceId?: string };
    if (!workspaceId) {
      throw new AppError(500, 'workspaceId param missing on rbac-guarded route', 'MISCONFIGURED_ROUTE');
    }

    const membership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: request.user.id } },
    });
    if (!membership) {
      throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
    }
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      throw new AppError(403, 'Insufficient permissions for this action', 'FORBIDDEN');
    }

    request.membership = membership;
  };
}
