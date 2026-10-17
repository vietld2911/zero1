import { ArrowLeftRight } from 'lucide-react';
import { APP_URLS, type AppKey } from './app-meta';

/** Liên kết sang app còn lại (đăng nhập dùng chung — docs/architecture.md §2). */
export function AppSwitchLink({ to }: { to: AppKey }) {
  return (
    <a
      href={APP_URLS[to]}
      className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
    >
      <ArrowLeftRight className="size-3.5" aria-hidden />
      Chuyển sang {to.toUpperCase()}
    </a>
  );
}
