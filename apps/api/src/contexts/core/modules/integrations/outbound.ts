import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { AppError } from '../../../../platform/http/errors.js';

/** Gửi HTTP ra ngoài — tách ra để test thay bằng bản giả. `body` chỉ dùng nội bộ (log / Telegram), không trả cho người dùng. */
export type HttpSender = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number; body: string }>;

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, metadata cloud
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast + dành riêng + broadcast
];
const V6_BLOCKED: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['100::', 64], // discard
  ['2001::', 32], // Teredo (chứa IPv4 bị che)
  ['2001:db8::', 32],
  ['64:ff9b:1::', 48],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (cũ)
  ['ff00::', 8], // multicast
];
const v4List = new BlockList();
for (const [net, prefix] of V4_BLOCKED) v4List.addSubnet(net, prefix, 'ipv4');
const v6List = new BlockList();
for (const [net, prefix] of V6_BLOCKED) v6List.addSubnet(net, prefix, 'ipv6');

/** IPv6 → 8 nhóm 16 bit (nhận cả đuôi dạng a.b.c.d). Sai định dạng → null. */
function expandV6(ip: string): number[] | null {
  let s = ip;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups = parts.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** IPv4 nằm trong IPv6 (IPv4-mapped / -compatible / SIIT / NAT64 / 6to4). */
function embeddedV4(g: number[]): string | null {
  const quad = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return quad(g[6]!, g[7]!); // ::ffff:a.b.c.d, ::a.b.c.d
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return quad(g[6]!, g[7]!); // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return quad(g[6]!, g[7]!); // 64:ff9b::/96
  if (g[0] === 0x2002) return quad(g[1]!, g[2]!); // 6to4
  return null;
}

/** Địa chỉ nội bộ / dành riêng (chặn để webhook không bị lợi dụng gọi vào mạng trong — SSRF). Không nhận ra → coi là nội bộ. */
export function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').split('%')[0]!;
  const kind = isIP(ip);
  if (kind === 4) return v4List.check(ip, 'ipv4');
  if (kind !== 6) return true;
  const groups = expandV6(ip);
  if (!groups) return true;
  const v4 = embeddedV4(groups);
  if (v4) return v4List.check(v4, 'ipv4');
  return v6List.check(ip, 'ipv6');
}

export const privateAddressError = () => new AppError(422, 'WEBHOOK_PRIVATE_ADDRESS', 'Webhook không được trỏ vào địa chỉ nội bộ');

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup chặn địa chỉ nội bộ ngay lúc kết nối — tránh DNS rebinding (kiểm tra xong tên miền đổi sang IP nội bộ). */
function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return callback(privateAddressError() as unknown as NodeJS.ErrnoException, '');
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const MAX_BODY = 2000;

/** Gửi bằng node:http(s): không theo redirect, kiểm tra IP lúc kết nối (trừ khi cho phép địa chỉ nội bộ). */
export function createHttpSender({ allowPrivate }: { allowPrivate: boolean }): HttpSender {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        u,
        {
          method: init.method,
          headers: { ...init.headers, 'content-length': String(Buffer.byteLength(init.body)) },
          signal: AbortSignal.timeout(init.timeoutMs),
          ...(allowPrivate ? {} : { lookup: guardedLookup as never }),
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (body.length < MAX_BODY) body += chunk.slice(0, MAX_BODY - body.length);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(init.body);
    });
}
