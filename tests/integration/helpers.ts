import crypto from 'node:crypto';
import { buildApp, type App } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis, redisPub, redisSub } from '../../src/lib/redis.js';
import type { AuthReply } from '../../src/modules/auth/schemas.js';

/**
 * Integration tests need live Postgres and Redis (docker compose locally, or
 * the service containers in CI). When either is missing the suites skip
 * instead of failing, so `npm test` stays green on machines without Docker.
 */
export async function servicesAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    await teardownClients();
    return false;
  }
}

export async function createApp(): Promise<App> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Each test file runs in its own process; closing the shared clients there
 * lets vitest exit without dangling handles. */
export async function teardownClients(app?: App): Promise<void> {
  if (app) await app.close();
  await prisma.$disconnect().catch(() => undefined);
  for (const client of [redis, redisPub, redisSub]) client.disconnect();
}

export function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@test.syncscript.local`;
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(app: App, label: string): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: uniqueEmail(label), password: 'correct horse battery', name: label },
  });
  if (res.statusCode !== 201) {
    throw new Error(`registration failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<AuthReply>();
  return {
    id: body.user.id,
    email: body.user.email,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
  };
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export async function createWorkspace(
  app: App,
  accessToken: string,
  name = 'Test Workspace',
): Promise<{ id: string; slug: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: bearer(accessToken),
    payload: { name },
  });
  if (res.statusCode !== 201) {
    throw new Error(`workspace creation failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ id: string; slug: string }>();
}

export async function createDocument(
  app: App,
  accessToken: string,
  workspaceId: string,
  payload: { title?: string; parentId?: string } = {},
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/documents`,
    headers: bearer(accessToken),
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`document creation failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ id: string }>();
}
