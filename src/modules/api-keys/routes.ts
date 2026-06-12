import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireWorkspaceRole } from '../../middlewares/rbac.js';
import {
  apiKeyListReply,
  apiKeyParams,
  apiKeyReply,
  createApiKeyBody,
  createApiKeyReply,
} from './schemas.js';
import * as apiKeyService from './service.js';

const workspaceScope = apiKeyParams.pick({ workspaceId: true });

// Key management is owner-only: API keys grant external read access to
// workspace content.
export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate);

  app.post(
    '/',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: {
        params: workspaceScope,
        body: createApiKeyBody,
        response: { 201: createApiKeyReply },
      },
    },
    async (request, reply) => {
      const created = await apiKeyService.createApiKey(
        request.params.workspaceId,
        request.user!.id,
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: { params: workspaceScope, response: { 200: apiKeyListReply } },
    },
    async (request) => apiKeyService.listApiKeys(request.params.workspaceId),
  );

  app.delete(
    '/:apiKeyId',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: { params: apiKeyParams, response: { 200: apiKeyReply } },
    },
    async (request) =>
      apiKeyService.revokeApiKey(request.params.workspaceId, request.params.apiKeyId),
  );
};
