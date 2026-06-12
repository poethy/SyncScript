import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { authRoutes } from './modules/auth/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { apiKeyRoutes } from './modules/api-keys/routes.js';
import { deliveryRoutes } from './modules/delivery/routes.js';

const PING_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function pingPostgres(): Promise<'up' | 'down'> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, PING_TIMEOUT_MS);
    return 'up';
  } catch {
    return 'down';
  }
}

async function pingRedis(): Promise<'up' | 'down'> {
  try {
    const pong = await withTimeout(redis.ping(), PING_TIMEOUT_MS);
    return pong === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(cors, { origin: true });

  app.decorateRequest('user', null);
  app.decorateRequest('membership', null);
  app.decorateRequest('apiKey', null);

  // Liveness + dependency visibility. Always 200 so orchestrators don't kill
  // the process over a flapping dependency; readiness gating can key off the
  // individual service statuses.
  app.get('/healthz', async () => {
    const [postgres, redisStatus] = await Promise.all([pingPostgres(), pingRedis()]);
    return { status: 'ok', services: { postgres, redis: redisStatus } };
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  await app.register(documentRoutes, { prefix: '/api/v1/workspaces/:workspaceId/documents' });
  await app.register(apiKeyRoutes, { prefix: '/api/v1/workspaces/:workspaceId/api-keys' });
  await app.register(deliveryRoutes, { prefix: '/api/v1/delivery' });

  // Remaining domain modules (documents, api-keys, delivery) register their
  // routes here as they land — see ROADMAP.md.

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
