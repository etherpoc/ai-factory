import { describe, it, expect } from 'vitest';
import { createAdaptorServer } from '@hono/node-server';
import request from 'supertest';
import { app } from '../src/index.js';

const server = createAdaptorServer(app);

describe('GET /health', () => {
  it('200 と { status: "ok" } を返す', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /unknown', () => {
  it('存在しないルートで 404 を返す', async () => {
    const res = await request(server).get('/unknown-route');
    expect(res.status).toBe(404);
  });
});
