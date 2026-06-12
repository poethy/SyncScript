import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { redis, redisPub, redisSub } from './lib/redis.js';
import { attachRealtimeGateway } from './realtime/gateway.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const io = attachRealtimeGateway(app.server);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await io.close();
    await app.close();
    await prisma.$disconnect();
    for (const client of [redis, redisPub, redisSub]) client.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  // Logger may not exist yet if env validation failed — fall back to console.
  console.error(err);
  process.exit(1);
});
