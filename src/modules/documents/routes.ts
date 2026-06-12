import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireWorkspaceRole } from '../../middlewares/rbac.js';
import {
  createDocumentBody,
  documentDetailReply,
  documentParams,
  documentReply,
  documentTreeReply,
  listDocumentsQuery,
  updateDocumentBody,
} from './schemas.js';
import * as documentService from './service.js';

const workspaceScope = documentParams.pick({ workspaceId: true });

export const documentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate);

  app.post(
    '/',
    {
      preHandler: [requireWorkspaceRole('EDITOR')],
      schema: { params: workspaceScope, body: createDocumentBody, response: { 201: documentReply } },
    },
    async (request, reply) => {
      const doc = await documentService.createDocument(
        request.params.workspaceId,
        request.user!.id,
        request.body,
      );
      return reply.status(201).send(doc);
    },
  );

  app.get(
    '/',
    {
      preHandler: [requireWorkspaceRole('VIEWER')],
      schema: {
        params: workspaceScope,
        querystring: listDocumentsQuery,
        response: { 200: documentTreeReply },
      },
    },
    async (request) =>
      documentService.listDocumentTree(
        request.params.workspaceId,
        request.query.includeArchived,
      ),
  );

  app.get(
    '/:documentId',
    {
      preHandler: [requireWorkspaceRole('VIEWER')],
      schema: { params: documentParams, response: { 200: documentDetailReply } },
    },
    async (request) =>
      documentService.getDocument(request.params.workspaceId, request.params.documentId),
  );

  app.patch(
    '/:documentId',
    {
      preHandler: [requireWorkspaceRole('EDITOR')],
      schema: {
        params: documentParams,
        body: updateDocumentBody,
        response: { 200: documentDetailReply },
      },
    },
    async (request) =>
      documentService.updateDocument(
        request.params.workspaceId,
        request.params.documentId,
        request.body,
      ),
  );

  app.delete(
    '/:documentId',
    { preHandler: [requireWorkspaceRole('EDITOR')], schema: { params: documentParams } },
    async (request, reply) => {
      await documentService.deleteDocument(request.params.workspaceId, request.params.documentId);
      return reply.status(204).send();
    },
  );
};
