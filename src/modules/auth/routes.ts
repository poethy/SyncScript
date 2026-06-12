import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authReply, loginBody, registerBody } from './schemas.js';
import * as authService from './service.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/register',
    { schema: { body: registerBody, response: { 201: authReply } } },
    async (request, reply) => {
      const result = await authService.register(request.body);
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/login',
    { schema: { body: loginBody, response: { 200: authReply } } },
    async (request) => authService.login(request.body),
  );
};
