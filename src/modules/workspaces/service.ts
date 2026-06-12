import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { uniqueSlug } from '../../utils/slug.js';
import type { WorkspaceRole } from '../../generated/prisma/client.js';
import type { MemberReply, WorkspaceReply } from './schemas.js';

const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

// Non-members get 404 (not 403) so responses do not reveal that a workspace
// with this id exists.
async function requireMembership(workspaceId: string, userId: string, minRole: WorkspaceRole = 'VIEWER') {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) {
    throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
  }
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new AppError(403, 'Insufficient permissions for this action', 'FORBIDDEN');
  }
  return membership;
}

async function ownerCount(workspaceId: string): Promise<number> {
  return prisma.workspaceMembership.count({ where: { workspaceId, role: 'OWNER' } });
}

export async function createWorkspace(userId: string, name: string): Promise<WorkspaceReply> {
  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug: uniqueSlug(name),
      createdById: userId,
      memberships: { create: { userId, role: 'OWNER' } },
    },
  });
  const { id, slug, createdAt, updatedAt } = workspace;
  return { id, name: workspace.name, slug, role: 'OWNER', createdAt, updatedAt };
}

export async function listWorkspaces(userId: string): Promise<WorkspaceReply[]> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map(({ role, workspace }) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }));
}

export async function getWorkspace(workspaceId: string, userId: string): Promise<WorkspaceReply> {
  const membership = await requireMembership(workspaceId, userId);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: membership.role,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  name: string,
): Promise<WorkspaceReply> {
  const membership = await requireMembership(workspaceId, userId, 'OWNER');
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: membership.role,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
  await requireMembership(workspaceId, userId, 'OWNER');
  // Cascades to memberships, documents (whole trees) and api keys.
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

export async function listMembers(workspaceId: string, userId: string): Promise<MemberReply[]> {
  await requireMembership(workspaceId, userId);
  const memberships = await prisma.workspaceMembership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    joinedAt: m.createdAt,
  }));
}

export async function addMember(
  workspaceId: string,
  requesterId: string,
  email: string,
  role: WorkspaceRole,
): Promise<MemberReply> {
  await requireMembership(workspaceId, requesterId, 'OWNER');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new AppError(404, 'No account exists for this email', 'USER_NOT_FOUND');
  }

  const existing = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (existing) {
    throw new AppError(409, 'User is already a member of this workspace', 'ALREADY_MEMBER');
  }

  const membership = await prisma.workspaceMembership.create({
    data: { workspaceId, userId: user.id, role },
  });
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: membership.role,
    joinedAt: membership.createdAt,
  };
}

export async function updateMemberRole(
  workspaceId: string,
  requesterId: string,
  targetUserId: string,
  role: WorkspaceRole,
): Promise<MemberReply> {
  await requireMembership(workspaceId, requesterId, 'OWNER');

  const target = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!target) {
    throw new AppError(404, 'Member not found in this workspace', 'MEMBER_NOT_FOUND');
  }

  if (target.role === 'OWNER' && role !== 'OWNER' && (await ownerCount(workspaceId)) === 1) {
    throw new AppError(400, 'Cannot demote the only owner of a workspace', 'LAST_OWNER');
  }

  const updated = await prisma.workspaceMembership.update({
    where: { id: target.id },
    data: { role },
  });
  return {
    userId: target.user.id,
    email: target.user.email,
    name: target.user.name,
    role: updated.role,
    joinedAt: target.createdAt,
  };
}

export async function removeMember(
  workspaceId: string,
  requesterId: string,
  targetUserId: string,
): Promise<void> {
  const requester = await requireMembership(workspaceId, requesterId);
  // Any member may leave; removing someone else requires OWNER.
  if (targetUserId !== requesterId && requester.role !== 'OWNER') {
    throw new AppError(403, 'Only owners can remove other members', 'FORBIDDEN');
  }

  const target = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  if (!target) {
    throw new AppError(404, 'Member not found in this workspace', 'MEMBER_NOT_FOUND');
  }

  if (target.role === 'OWNER' && (await ownerCount(workspaceId)) === 1) {
    throw new AppError(400, 'Transfer ownership before removing the only owner', 'LAST_OWNER');
  }

  await prisma.workspaceMembership.delete({ where: { id: target.id } });
}
