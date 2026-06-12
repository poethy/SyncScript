import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import type { AuthReply, PublicUser } from '../../src/modules/auth/schemas.js';
import {
  bearer,
  createApp,
  registerUser,
  servicesAvailable,
  teardownClients,
  uniqueEmail,
} from './helpers.js';

const available = await servicesAvailable();

describe.skipIf(!available)('auth', () => {
  let app: App;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await teardownClients(app);
  });

  it('registers a user and returns tokens', async () => {
    const email = uniqueEmail('register');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct horse battery', name: 'Reg' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<AuthReply>();
    expect(body.user.email).toBe(email);
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it('rejects duplicate registration with 409', async () => {
    const user = await registerUser(app, 'dupe');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: user.email, password: 'another password!', name: 'Dupe' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects bad credentials with the same 401 for wrong email and wrong password', async () => {
    const user = await registerUser(app, 'badcreds');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'wrong password here' },
    });
    const wrongEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: uniqueEmail('ghost'), password: 'wrong password here' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(wrongEmail.json());
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const user = await registerUser(app, 'rotate');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json<AuthReply>().tokens.refreshToken;

    // Replaying the original (now rotated) token is treated as theft…
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(replay.statusCode).toBe(401);

    // …which revokes every active session, including the freshly rotated one.
    const afterReuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: rotated },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('serves the profile on /me and rejects missing tokens', async () => {
    const user = await registerUser(app, 'me');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(user.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<PublicUser>().email).toBe(user.email);

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(anonymous.statusCode).toBe(401);
  });
});
