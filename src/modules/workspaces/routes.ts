import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireWorkspaceRole } from '../../middlewares/rbac.js';
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
    {
      preHandler: [requireWorkspaceRole('VIEWER')],
      schema: { params: workspaceParams, response: { 200: workspaceReply } },
    },
    async (request) =>
      workspaceService.getWorkspace(request.params.workspaceId, request.membership!.role),
  );

  app.patch(
    '/:workspaceId',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: {
        params: workspaceParams,
        body: updateWorkspaceBody,
        response: { 200: workspaceReply },
      },
    },
    async (request) =>
      workspaceService.updateWorkspace(request.params.workspaceId, request.body.name),
  );

  app.delete(
    '/:workspaceId',
    { preHandler: [requireWorkspaceRole('OWNER')], schema: { params: workspaceParams } },
    async (request, reply) => {
      await workspaceService.deleteWorkspace(request.params.workspaceId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/:workspaceId/members',
    {
      preHandler: [requireWorkspaceRole('VIEWER')],
      schema: { params: workspaceParams, response: { 200: memberListReply } },
    },
    async (request) => workspaceService.listMembers(request.params.workspaceId),
  );

  app.post(
    '/:workspaceId/members',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: { params: workspaceParams, body: addMemberBody, response: { 201: memberReply } },
    },
    async (request, reply) => {
      const member = await workspaceService.addMember(
        request.params.workspaceId,
        request.body.email,
        request.body.role,
      );
      return reply.status(201).send(member);
    },
  );

  app.patch(
    '/:workspaceId/members/:userId',
    {
      preHandler: [requireWorkspaceRole('OWNER')],
      schema: { params: memberParams, body: updateMemberBody, response: { 200: memberReply } },
    },
    async (request) =>
      workspaceService.updateMemberRole(
        request.params.workspaceId,
        request.params.userId,
        request.body.role,
      ),
  );

  app.delete(
    '/:workspaceId/members/:userId',
    {
      // VIEWER floor: any member may hit this to leave; the service enforces
      // that removing someone else requires OWNER.
      preHandler: [requireWorkspaceRole('VIEWER')],
      schema: { params: memberParams },
    },
    async (request, reply) => {
      await workspaceService.removeMember(
        request.params.workspaceId,
        request.membership!,
        request.params.userId,
      );
      return reply.status(204).send();
    },
  );
};
