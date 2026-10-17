import { cn } from '@zero1/ui';
import { fileUrl } from '@zero1/web-core';

/** Ảnh học viên, không có ảnh thì hiện chữ cái đầu của tên. */
export function StudentAvatar({ name, url, size = 'md' }: { name: string; url: string | null; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16 text-xl' : 'size-9 text-sm';
  if (url) return <img src={fileUrl(url)} alt="" className={cn('shrink-0 rounded-full object-cover', box)} />;
  const initial = name.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? '?';
  return <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-700', box)} aria-hidden>{initial}</span>;
}
