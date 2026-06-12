import { z } from 'zod';

export const registerBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const publicUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export const authReply = z.object({
  user: publicUser,
  tokens: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    /** Access token lifetime in seconds. */
    expiresIn: z.number(),
  }),
});

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type PublicUser = z.infer<typeof publicUser>;
export type AuthReply = z.infer<typeof authReply>;
