import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { authReply, loginBody, publicUser, refreshBody, registerBody } from './schemas.js';
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

  app.post(
    '/refresh',
    { schema: { body: refreshBody, response: { 200: authReply } } },
    async (request) => authService.rotateRefreshToken(request.body.refreshToken),
  );

  app.post('/logout', { schema: { body: refreshBody } }, async (request, reply) => {
    await authService.logout(request.body.refreshToken);
    return reply.status(204).send();
  });

  app.get(
    '/me',
    { preHandler: [authenticate], schema: { response: { 200: publicUser } } },
    async (request) => authService.getMe(request.user!.id),
  );
};
