import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { uniqueSlug } from '../../utils/slug.js';
import type { WorkspaceMembership, WorkspaceRole } from '../../generated/prisma/client.js';
import type { MemberReply, WorkspaceReply } from './schemas.js';

// Access control (membership + minimum role) is enforced by the
// requireWorkspaceRole preHandler before any of these run; this service only
// guards business invariants such as the last-owner rule.

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

export async function getWorkspace(
  workspaceId: string,
  requesterRole: WorkspaceRole,
): Promise<WorkspaceReply> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: requesterRole,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function updateWorkspace(workspaceId: string, name: string): Promise<WorkspaceReply> {
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: 'OWNER',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  // Cascades to memberships, documents (whole trees) and api keys.
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

export async function listMembers(workspaceId: string): Promise<MemberReply[]> {
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
  email: string,
  role: WorkspaceRole,
): Promise<MemberReply> {
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
  targetUserId: string,
  role: WorkspaceRole,
): Promise<MemberReply> {
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
  requester: WorkspaceMembership,
  targetUserId: string,
): Promise<void> {
  // Any member may leave; removing someone else requires OWNER.
  if (targetUserId !== requester.userId && requester.role !== 'OWNER') {
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
