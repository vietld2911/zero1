import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createApp, type AppDeps } from '../src/app.js';
import { z } from '../src/platform/openapi/zod.js';
import { AppError } from '../src/platform/http/errors.js';
import { item } from '../src/platform/http/schemas.js';

const logger = pino({ level: 'silent' });

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    env: { CORS_ORIGINS: [] },
    logger,
    version: '0.0.0-test',
    healthChecks: { 'db.core': async () => {} },
    ...overrides,
  });
}

const EchoBody = z.object({ name: z.string().min(1) });

const withTestRoutes: AppDeps['registerRoutes'] = (route) => {
  route({
    method: 'post',
    path: '/test/echo',
    tags: ['system'],
    summary: 'echo',
    access: { public: true },
    request: { body: EchoBody },
    responses: { 201: { description: 'ok', schema: item(EchoBody) } },
    handler: ({ body }) => ({ data: body }),
  });
  route({
    method: 'get',
    path: '/test/conflict/:id',
    tags: ['system'],
    summary: 'conflict',
    access: { public: true },
    responses: { 200: { description: 'ok' } },
    handler: () => {
      throw new AppError(409, 'LEAD_PHONE_DUPLICATE', 'Số điện thoại đã tồn tại');
    },
  });
  route({
    method: 'get',
    path: '/test/boom',
    tags: ['system'],
    summary: 'boom',
    access: { public: true },
    responses: { 200: { description: 'ok' } },
    handler: () => {
      throw new Error('secret internal detail');
    },
  });
};

describe('health', () => {
  it('trả 200 khi mọi DB hoạt động', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok', checks: { 'db.core': 'up' }, version: '0.0.0-test' });
  });

  it('trả 503 khi một DB không kết nối được', async () => {
    const app = makeApp({
      healthChecks: { 'db.core': async () => {}, 'db.crm': async () => Promise.reject(new Error('down')) },
    });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.data.checks).toEqual({ 'db.core': 'up', 'db.crm': 'down' });
  });
});

describe('lỗi theo RFC 7807', () => {
  it('endpoint không tồn tại → 404 problem+json kèm requestId', async () => {
    const res = await request(makeApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'ROUTE_NOT_FOUND', status: 404, type: 'urn:zero1:error:ROUTE_NOT_FOUND' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('giữ X-Request-Id hợp lệ từ client', async () => {
    const res = await request(makeApp()).get('/api/v1/health').set('X-Request-Id', 'client-req-12345');
    expect(res.headers['x-request-id']).toBe('client-req-12345');
  });

  it('body sai schema → 400 VALIDATION_ERROR có đường dẫn field', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes })).post('/api/v1/test/echo').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].path).toBe('body.name');
  });

  it('body không phải JSON → 400 INVALID_JSON', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes }))
      .post('/api/v1/test/echo')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
  });

  it('AppError giữ nguyên status và code', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes })).get('/api/v1/test/conflict/1');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'LEAD_PHONE_DUPLICATE', title: 'Số điện thoại đã tồn tại' });
  });

  it('lỗi bất ngờ → 500 và không lộ chi tiết nội bộ', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes })).get('/api/v1/test/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});

describe('route registrar', () => {
  it('trả status thành công khai báo trong spec', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes })).post('/api/v1/test/echo').send({ name: 'An' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: 'An' } });
  });

  it('từ chối khởi động nếu route cần quyền mà chưa có guards', () => {
    expect(() =>
      makeApp({
        registerRoutes: (route) =>
          route({
            method: 'get',
            path: '/crm/leads',
            tags: ['crm'],
            summary: 'leads',
            access: { permission: 'crm.leads.read' },
            responses: { 200: { description: 'ok' } },
            handler: () => ({ data: [] }),
          }),
      }),
    ).toThrow(/chưa cấu hình guards/);
  });
});

describe('OpenAPI', () => {
  it('sinh tài liệu từ route đã khai báo', async () => {
    const res = await request(makeApp({ registerRoutes: withTestRoutes })).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/api/v1/health'].get.summary).toBe('Tình trạng hệ thống');
    expect(res.body.paths['/api/v1/test/conflict/{id}']).toBeDefined();
    const echo = res.body.paths['/api/v1/test/echo'].post;
    expect(echo.responses['201']).toBeDefined();
    expect(echo.responses['400'].content['application/problem+json']).toBeDefined();
  });
});

describe('OpenAPI — component dùng lại', () => {
  it('không có component nào bị đánh dấu nullable (dấu hiệu dùng .nullable() trên schema đã đặt tên)', async () => {
    const { pino: makeLogger } = await import('pino');
    const { loadEnv } = await import('../src/platform/env.js');
    const { buildApplication } = await import('../src/application.js');
    const env = loadEnv({ DB_HOST: 'unused', DB_USER: 'unused', JWT_ACCESS_SECRET: 'x'.repeat(32) });
    const built = buildApplication(env, makeLogger({ level: 'silent' }));
    const schemas = built.app.locals.openApiDocument.components.schemas as Record<string, { type?: unknown }>;
    const nullable = Object.entries(schemas).filter(([, s]) => Array.isArray(s.type) && s.type.includes('null')).map(([n]) => n);
    await built.close();
    expect(nullable).toEqual([]);
  });
});
