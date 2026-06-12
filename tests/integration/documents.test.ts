import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import type { DocumentTreeNode } from '../../src/modules/documents/schemas.js';
import {
  bearer,
  createApp,
  createDocument,
  createWorkspace,
  registerUser,
  servicesAvailable,
  teardownClients,
  type TestUser,
} from './helpers.js';

const available = await servicesAvailable();

describe.skipIf(!available)('documents', () => {
  let app: App;
  let owner: TestUser;
  let workspaceId: string;
  let rootId: string;
  let childId: string;
  let grandchildId: string;

  beforeAll(async () => {
    app = await createApp();
    owner = await registerUser(app, 'docs-owner');
    workspaceId = (await createWorkspace(app, owner.accessToken)).id;
    rootId = (await createDocument(app, owner.accessToken, workspaceId, { title: 'Root' })).id;
    childId = (
      await createDocument(app, owner.accessToken, workspaceId, { title: 'Child', parentId: rootId })
    ).id;
    grandchildId = (
      await createDocument(app, owner.accessToken, workspaceId, {
        title: 'Grandchild',
        parentId: childId,
      })
    ).id;
  });

  afterAll(async () => {
    await teardownClients(app);
  });

  it('lists documents as a nested tree', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/documents`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);

    const tree = res.json<DocumentTreeNode[]>();
    const root = tree.find((n) => n.id === rootId)!;
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.id).toBe(childId);
    expect(root.children[0]!.children[0]!.id).toBe(grandchildId);
  });

  it('resolves a sub-tree through the recursive cte endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/documents/${childId}/subtree`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);

    const subtree = res.json<DocumentTreeNode>();
    expect(subtree.id).toBe(childId);
    expect(subtree.children.map((n) => n.id)).toEqual([grandchildId]);
  });

  it('rejects moves that would create a cycle', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/documents/${rootId}`,
      headers: bearer(owner.accessToken),
      payload: { parentId: grandchildId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CIRCULAR_NESTING');
  });

  it('bumps contentVersion when content is updated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/documents/${grandchildId}`,
      headers: bearer(owner.accessToken),
      payload: { content: { blocks: [{ type: 'paragraph', text: 'hello' }] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contentVersion: number }>().contentVersion).toBe(1);
  });

  it('deletes a whole sub-tree via the cascading self-relation', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/documents/${childId}`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(204);

    const orphan = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/documents/${grandchildId}`,
      headers: bearer(owner.accessToken),
    });
    expect(orphan.statusCode).toBe(404);
  });
});
