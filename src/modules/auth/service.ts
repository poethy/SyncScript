import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { generateRefreshToken, signAccessToken } from './tokens.js';
import type { AuthReply, LoginInput, PublicUser, RegisterInput } from './schemas.js';

const publicUserSelect = { id: true, email: true, name: true, avatarUrl: true } as const;

async function issueTokens(user: PublicUser): Promise<AuthReply['tokens']> {
  const access = signAccessToken(user);
  const refresh = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { tokenHash: refresh.tokenHash, userId: user.id, expiresAt: refresh.expiresAt },
  });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: access.expiresInSeconds,
  };
}

export async function register(input: RegisterInput): Promise<AuthReply> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await argon2.hash(input.password);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name },
    select: publicUserSelect,
  });

  return { user, tokens: await issueTokens(user) };
}

export async function login(input: LoginInput): Promise<AuthReply> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Verify even on unknown email paths returning the same error, so the
  // response does not reveal which of the two fields was wrong.
  const valid = user !== null && (await argon2.verify(user.passwordHash, input.password));
  if (!user || !valid) {
    throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const { id, email, name, avatarUrl } = user;
  return { user: { id, email, name, avatarUrl }, tokens: await issueTokens(user) };
}
