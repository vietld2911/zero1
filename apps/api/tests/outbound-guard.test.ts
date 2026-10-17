import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { isPrivateIp } from '../src/contexts/core/modules/integrations/outbound.js';
import { parentLimitKey } from '../src/contexts/core/modules/parents/parents.module.js';
import { credentialLimits } from '../src/platform/http/rate-limit.js';

describe('isPrivateIp (chặn SSRF webhook)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:0:7f00:1',
    '::7f00:1',
    '64:ff9b::a00:1',
    '2002:c0a8:1::',
    '2001::1',
    'fd12::1',
    'fe80::1%eth0',
    '[::1]',
    'không-phải-ip',
  ])('%s → nội bộ', (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2002:0808:0808::'])('%s → công khai', (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe('giới hạn đăng nhập', () => {
  function app(status: () => number) {
    const a = express();
    a.use(express.json());
    a.post('/login', ...credentialLimits('t', (req) => parentLimitKey((req.body as { phone?: unknown }).phone)), (_req, res) => {
      res.status(status()).end();
    });
    a.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status ?? 500).end();
    });
    return a;
  }

  it('đổi cách viết SĐT không lách được giới hạn', async () => {
    const a = app(() => 401);
    const variants = ['0912345678', '+84912345678', '84912345678', '0912 345 678', '+84 912 345 678'];
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(a).post('/login').send({ phone: variants[i % variants.length] })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('lần đăng nhập đúng không bị tính', async () => {
    const a = app(() => 200);
    for (let i = 0; i < 15; i++) expect((await request(a).post('/login').send({ phone: '0912000111' })).status).toBe(200);
  });

  it('dò rải nhiều tài khoản từ một IP → bị chặn', async () => {
    const a = app(() => 401);
    const statuses: number[] = [];
    for (let i = 0; i < 52; i++) statuses.push((await request(a).post('/login').send({ phone: `09130000${String(i).padStart(2, '0')}` })).status);
    expect(statuses.slice(0, 50).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(50)).toEqual([429, 429]);
  });
});
