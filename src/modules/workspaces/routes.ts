import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate } from '../../middlewares/authenticate.js';
import {
  addMemberBody,
  createWorkspaceBody,
  memberListReply,
  memberParams,
  memberReply,
  updateMemberBody,
  updateWorkspaceBody,
  workspaceListReply,
  workspaceParams,
  workspaceReply,
} from './schemas.js';
import * as workspaceService from './service.js';

export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate);

  app.post(
    '/',
    { schema: { body: createWorkspaceBody, response: { 201: workspaceReply } } },
    async (request, reply) => {
      const workspace = await workspaceService.createWorkspace(
        request.user!.id,
        request.body.name,
      );
      return reply.status(201).send(workspace);
    },
  );

  app.get('/', { schema: { response: { 200: workspaceListReply } } }, async (request) =>
    workspaceService.listWorkspaces(request.user!.id),
  );

  app.get(
    '/:workspaceId',
    { schema: { params: workspaceParams, response: { 200: workspaceReply } } },
    async (request) =>
      workspaceService.getWorkspace(request.params.workspaceId, request.user!.id),
  );

  app.patch(
    '/:workspaceId',
    {
      schema: {
        params: workspaceParams,
        body: updateWorkspaceBody,
        response: { 200: workspaceReply },
      },
    },
    async (request) =>
      workspaceService.updateWorkspace(
        request.params.workspaceId,
        request.user!.id,
        request.body.name,
      ),
  );

  app.delete(
    '/:workspaceId',
    { schema: { params: workspaceParams } },
    async (request, reply) => {
      await workspaceService.deleteWorkspace(request.params.workspaceId, request.user!.id);
      return reply.status(204).send();
    },
  );

  app.get(
    '/:workspaceId/members',
    { schema: { params: workspaceParams, response: { 200: memberListReply } } },
    async (request) =>
      workspaceService.listMembers(request.params.workspaceId, request.user!.id),
  );

  app.post(
    '/:workspaceId/members',
    {
      schema: { params: workspaceParams, body: addMemberBody, response: { 201: memberReply } },
    },
    async (request, reply) => {
      const member = await workspaceService.addMember(
        request.params.workspaceId,
        request.user!.id,
        request.body.email,
        request.body.role,
      );
      return reply.status(201).send(member);
    },
  );

  app.patch(
    '/:workspaceId/members/:userId',
    { schema: { params: memberParams, body: updateMemberBody, response: { 200: memberReply } } },
    async (request) =>
      workspaceService.updateMemberRole(
        request.params.workspaceId,
        request.user!.id,
        request.params.userId,
        request.body.role,
      ),
  );

  app.delete(
    '/:workspaceId/members/:userId',
    { schema: { params: memberParams } },
    async (request, reply) => {
      await workspaceService.removeMember(
        request.params.workspaceId,
        request.user!.id,
        request.params.userId,
      );
      return reply.status(204).send();
    },
  );
};
