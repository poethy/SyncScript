import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import { rateLimit } from '../../middlewares/rateLimiter.js';
import { deliveryDocumentReply, deliveryParams } from './schemas.js';
import * as deliveryService from './service.js';

/** Public, API-key-authenticated read API for external consumers. */
export const deliveryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', apiKeyAuth);
  // After auth so buckets are per key (burst 60, sustained 10 rps), keeping
  // one noisy consumer from starving the rest.
  app.addHook(
    'preHandler',
    rateLimit({ capacity: 60, refillPerSecond: 10, keyFor: (request) => `key:${request.apiKey!.id}` }),
  );

  app.get(
    '/documents/:id',
    { schema: { params: deliveryParams, response: { 200: deliveryDocumentReply } } },
    async (request) => deliveryService.getDeliveryDocument(request.apiKey!, request.params.id),
  );
};
