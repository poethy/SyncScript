import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import { deliveryDocumentReply, deliveryParams } from './schemas.js';
import * as deliveryService from './service.js';

/** Public, API-key-authenticated read API for external consumers. */
export const deliveryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', apiKeyAuth);

  app.get(
    '/documents/:id',
    { schema: { params: deliveryParams, response: { 200: deliveryDocumentReply } } },
    async (request) => deliveryService.getDeliveryDocument(request.apiKey!, request.params.id),
  );
};
