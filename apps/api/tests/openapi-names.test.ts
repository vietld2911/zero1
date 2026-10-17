import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

describe('OpenAPI component names', () => {
  it('mỗi tên schema `.openapi(\'Name\')` chỉ khai báo một lần (trùng tên → schema này đè schema kia)', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of tsFiles(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\.openapi\(\s*'([A-Za-z0-9]+)'/g)) {
        const name = m[1]!;
        if (seen.has(name)) duplicates.push(`${name}: ${seen.get(name)} & ${file}`);
        else seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
