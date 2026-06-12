import { z } from 'zod';

export const workspaceRole = z.enum(['OWNER', 'EDITOR', 'VIEWER']);

export const createWorkspaceBody = z.object({
  name: z.string().min(1).max(100),
});

export const updateWorkspaceBody = z.object({
  name: z.string().min(1).max(100),
});

export const workspaceParams = z.object({
  workspaceId: z.string().min(1),
});

export const memberParams = workspaceParams.extend({
  userId: z.string().min(1),
});

export const workspaceReply = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** The requesting user's role in this workspace. */
  role: workspaceRole,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const workspaceListReply = z.array(workspaceReply);

export const addMemberBody = z.object({
  email: z.email(),
  role: workspaceRole.default('VIEWER'),
});

export const updateMemberBody = z.object({
  role: workspaceRole,
});

export const memberReply = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: workspaceRole,
  joinedAt: z.date(),
});

export const memberListReply = z.array(memberReply);

export type WorkspaceReply = z.infer<typeof workspaceReply>;
export type MemberReply = z.infer<typeof memberReply>;
