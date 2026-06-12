import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import type { CreateApiKeyReply } from '../../src/modules/api-keys/schemas.js';
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

describe.skipIf(!available)('delivery api', () => {
  let app: App;
  let owner: TestUser;
  let workspaceId: string;
  let rootId: string;
  let childId: string;
  let outsideId: string;
  let workspaceKey: CreateApiKeyReply;

  async function createKey(payload: { name: string; scopeDocumentId?: string }) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/api-keys`,
      headers: bearer(owner.accessToken),
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json<CreateApiKeyReply>();
  }

  beforeAll(async () => {
    app = await createApp();
    owner = await registerUser(app, 'delivery-owner');
    workspaceId = (await createWorkspace(app, owner.accessToken)).id;
    rootId = (await createDocument(app, owner.accessToken, workspaceId, { title: 'Scope root' })).id;
    childId = (
      await createDocument(app, owner.accessToken, workspaceId, {
        title: 'In scope',
        parentId: rootId,
      })
    ).id;
    outsideId = (
      await createDocument(app, owner.accessToken, workspaceId, { title: 'Out of scope' })
    ).id;
    workspaceKey = await createKey({ name: 'workspace-wide' });
  });

  afterAll(async () => {
    await teardownClients(app);
  });

  it('returns the secret exactly once and stores only a prefix', () => {
    expect(workspaceKey.secret.startsWith('ss_live_')).toBe(true);
    expect(workspaceKey.key.prefix).toBe(workspaceKey.secret.slice(0, 12));
    expect(JSON.stringify(workspaceKey.key)).not.toContain(workspaceKey.secret);
  });

  it('serves documents with a valid key and rejects missing keys', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
      headers: { 'x-api-key': workspaceKey.secret },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ id: string }>().id).toBe(rootId);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
    });
    expect(missing.statusCode).toBe(401);

    const garbage = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
      headers: { 'x-api-key': 'ss_live_not-a-real-key' },
    });
    expect(garbage.statusCode).toBe(401);
  });

  it('enforces sub-tree scoping with 404 outside the scope', async () => {
    const scoped = await createKey({ name: 'scoped', scopeDocumentId: rootId });

    const inScope = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${childId}`,
      headers: { 'x-api-key': scoped.secret },
    });
    expect(inScope.statusCode).toBe(200);

    const outOfScope = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${outsideId}`,
      headers: { 'x-api-key': scoped.secret },
    });
    expect(outOfScope.statusCode).toBe(404);
  });

  it('serves fresh content after an update evicts the cache', async () => {
    // Prime the cache.
    await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${outsideId}`,
      headers: { 'x-api-key': workspaceKey.secret },
    });

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/documents/${outsideId}`,
      headers: bearer(owner.accessToken),
      payload: { content: { blocks: [{ type: 'paragraph', text: 'fresh' }] } },
    });
    expect(update.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${outsideId}`,
      headers: { 'x-api-key': workspaceKey.secret },
    });
    expect(after.statusCode).toBe(200);
    const body = after.json<{ contentVersion: number; content: { blocks: unknown[] } }>();
    expect(body.contentVersion).toBe(1);
    expect(body.content.blocks).toHaveLength(1);
  });

  it('rejects revoked keys', async () => {
    const shortLived = await createKey({ name: 'to-revoke' });
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/api-keys/${shortLived.key.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(revoke.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
      headers: { 'x-api-key': shortLived.secret },
    });
    expect(res.statusCode).toBe(401);
  });

  it('emits rate limit headers that count down', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
      headers: { 'x-api-key': workspaceKey.secret },
    });
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/delivery/documents/${rootId}`,
      headers: { 'x-api-key': workspaceKey.secret },
    });

    expect(first.headers['x-ratelimit-limit']).toBe('60');
    const remainingFirst = Number(first.headers['x-ratelimit-remaining']);
    const remainingSecond = Number(second.headers['x-ratelimit-remaining']);
    expect(remainingSecond).toBeLessThanOrEqual(remainingFirst);
  });
});
