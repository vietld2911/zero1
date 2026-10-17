import type { ReactNode } from 'react';
import { Logo } from '@zero1/ui';
import type { AppMeta } from '../app-meta';

/** Khung màn đăng nhập: bên trái nền navy + logo, bên phải form. */
export function AuthLayout({ meta, title, description, children }: { meta: AppMeta; title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-navy-900 px-6 py-6 text-white lg:w-[44%] lg:px-12 lg:py-12">
        <Logo tone="onDark" className="h-9 self-start lg:h-11" />
        <div className="mt-10 hidden max-w-md lg:block">
          <span className="rounded bg-cyan-brand px-2 py-0.5 text-xs font-bold tracking-wide text-navy-950">{meta.name}</span>
          <p className="mt-4 text-3xl leading-tight font-semibold">{meta.tagline}</p>
          <p className="mt-3 text-navy-200">{meta.pitch}</p>
        </div>
        <p className="mt-10 hidden text-xs text-navy-400 lg:block">© Zero1 Technology</p>
        {/* Hai dải màu nhấn lấy từ logo */}
        <div className="pointer-events-none absolute -right-24 -bottom-24 hidden size-72 rotate-45 bg-cyan-brand/10 lg:block" aria-hidden />
        <div className="pointer-events-none absolute -right-10 bottom-40 hidden h-3 w-56 rotate-45 bg-lime-brand/40 lg:block" aria-hidden />
      </aside>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
