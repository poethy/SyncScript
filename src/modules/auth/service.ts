import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';
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

export async function rotateRefreshToken(rawToken: string): Promise<AuthReply> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: { select: publicUserSelect } },
  });

  if (!stored) {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  if (stored.revokedAt) {
    // A rotated token came back: assume the credential family is compromised
    // and revoke every active session for this user.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, 'Refresh token reuse detected', 'REFRESH_TOKEN_REUSED');
  }

  if (stored.expiresAt < new Date()) {
    throw new AppError(401, 'Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return { user: stored.user, tokens: await issueTokens(stored.user) };
}

export async function logout(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) {
    throw new AppError(401, 'Account no longer exists', 'UNAUTHORIZED');
  }
  return user;
}
