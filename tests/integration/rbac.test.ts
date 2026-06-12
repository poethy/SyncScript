import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import {
  bearer,
  createApp,
  createWorkspace,
  registerUser,
  servicesAvailable,
  teardownClients,
  type TestUser,
} from './helpers.js';

const available = await servicesAvailable();

describe.skipIf(!available)('workspace rbac', () => {
  let app: App;
  let owner: TestUser;
  let member: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createApp();
    owner = await registerUser(app, 'owner');
    member = await registerUser(app, 'member');
    workspaceId = (await createWorkspace(app, owner.accessToken)).id;
  });

  afterAll(async () => {
    await teardownClients(app);
  });

  it('returns 404 (not 403) for non-members so workspace existence stays hidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: bearer(member.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('owner can add a member as viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      headers: bearer(owner.accessToken),
      payload: { email: member.email, role: 'VIEWER' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('viewer can read but cannot create documents or edit the workspace', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: bearer(member.accessToken),
    });
    expect(read.statusCode).toBe(200);

    const createDoc = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/documents`,
      headers: bearer(member.accessToken),
      payload: { title: 'Nope' },
    });
    expect(createDoc.statusCode).toBe(403);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: bearer(member.accessToken),
      payload: { name: 'Hijacked' },
    });
    expect(rename.statusCode).toBe(403);
  });

  it('editor can create documents after promotion', async () => {
    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/members/${member.id}`,
      headers: bearer(owner.accessToken),
      payload: { role: 'EDITOR' },
    });
    expect(promote.statusCode).toBe(200);

    const createDoc = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/documents`,
      headers: bearer(member.accessToken),
      payload: { title: 'Editor doc' },
    });
    expect(createDoc.statusCode).toBe(201);
  });

  it('refuses to demote or remove the only owner', async () => {
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/members/${owner.id}`,
      headers: bearer(owner.accessToken),
      payload: { role: 'VIEWER' },
    });
    expect(demote.statusCode).toBe(400);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/members/${owner.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(remove.statusCode).toBe(400);
  });

  it('a member can leave on their own', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/members/${member.id}`,
      headers: bearer(member.accessToken),
    });
    expect(res.statusCode).toBe(204);
  });
});
