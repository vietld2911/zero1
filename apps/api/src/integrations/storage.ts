import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { Logger } from '../platform/logger.js';

export interface StoredFile {
  url: string;
  key: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface FileStorage {
  readonly driver: 'local' | 'cloudinary';
  save(file: { buffer: Buffer; name: string; mimeType: string }, folder: string): Promise<StoredFile>;
}

/** Tên file an toàn: bỏ dấu / ký tự lạ, giữ đuôi. */
function safeName(name: string) {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const base = name
    .slice(0, name.length - extname(name).length)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'file'}${ext}`;
}

/**
 * Lưu trên đĩa (dev). Đường dẫn chứa phần ngẫu nhiên 128 bit nên không đoán được,
 * phục vụ công khai tại `/files/...` (thẻ <img>, link tải không gửi được token).
 */
export function createLocalStorage(dir: string, publicBase = '/files'): FileStorage {
  const root = resolve(dir);
  return {
    driver: 'local',
    async save(file, folder) {
      const key = `${folder.replace(/[^a-z0-9/_-]/gi, '')}/${randomBytes(16).toString('hex')}/${safeName(file.name)}`;
      const path = join(root, key);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, file.buffer);
      return { url: `${publicBase}/${key}`, key, name: file.name, size: file.buffer.length, mimeType: file.mimeType };
    },
  };
}

/** Cloudinary qua REST (upload có chữ ký) — không cần SDK. `CLOUDINARY_URL=cloudinary://key:secret@cloud`. */
export function createCloudinaryStorage(cloudinaryUrl: string, logger: Logger): FileStorage {
  const m = /^cloudinary:\/\/(\w+):([\w-]+)@([\w-]+)$/.exec(cloudinaryUrl);
  if (!m) throw new Error('CLOUDINARY_URL không đúng dạng cloudinary://<key>:<secret>@<cloud>');
  const [, apiKey, apiSecret, cloud] = m as unknown as [string, string, string, string];
  return {
    driver: 'cloudinary',
    async save(file, folder) {
      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = `${randomBytes(8).toString('hex')}-${safeName(file.name).replace(/\.[^.]+$/, '')}`;
      const params = { folder: `zero1/${folder}`, public_id: publicId, timestamp: String(timestamp) };
      const toSign = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      const signature = createHash('sha1').update(toSign + apiSecret).digest('hex');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append('api_key', apiKey);
      form.append('signature', signature);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/auto/upload`, { method: 'POST', body: form });
      if (!res.ok) {
        logger.error({ status: res.status, body: await res.text() }, 'Cloudinary upload failed');
        throw new Error('Tải file lên Cloudinary thất bại');
      }
      const body = (await res.json()) as { secure_url: string; public_id: string; bytes: number };
      return { url: body.secure_url, key: body.public_id, name: file.name, size: body.bytes, mimeType: file.mimeType };
    },
  };
}

/** Bộ nhớ tạm cho test. */
export function createMemoryStorage(): FileStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    driver: 'local',
    files,
    async save(file, folder) {
      const key = `${folder}/${randomBytes(8).toString('hex')}/${safeName(file.name)}`;
      files.set(key, file.buffer);
      return { url: `/files/${key}`, key, name: file.name, size: file.buffer.length, mimeType: file.mimeType };
    },
  };
}
