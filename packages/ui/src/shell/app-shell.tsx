import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { Logo } from '../brand/logo';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

interface AppShellProps {
  /** Tên ngắn hiển thị cạnh logo, ví dụ "CRM". */
  appName: string;
  /** Mô tả một dòng, ví dụ "Kinh doanh & tuyển sinh". */
  appTagline: string;
  nav: NavGroup[];
  /** Nội dung cuối sidebar (trạng thái hệ thống, chuyển app). */
  sidebarFooter?: ReactNode;
  /** Nội dung bên phải thanh trên (chọn chi nhánh, tài khoản). */
  topbarEnd?: ReactNode;
  children: ReactNode;
}

export function AppShell({ appName, appTagline, nav, sidebarFooter, topbarEnd, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (onNavigate?: () => void) => (
    <SidebarContent appName={appName} appTagline={appTagline} nav={nav} footer={sidebarFooter} onNavigate={onNavigate} />
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">{sidebar()}</aside>

      {/* Mobile drawer */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-xl outline-none lg:hidden"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Menu {appName}</Dialog.Title>
            <Dialog.Close
              className="absolute top-4 right-3 z-10 rounded-md p-1.5 text-navy-200 hover:bg-navy-800 hover:text-white"
              aria-label="Đóng menu"
            >
              <X className="size-5" />
            </Dialog.Close>
            {sidebar(() => setMobileOpen(false))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="-ml-1.5 rounded-md p-1.5 text-foreground hover:bg-muted lg:hidden"
          aria-label="Mở menu"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2 lg:hidden">
          <Logo className="h-6" />
          <span className="text-sm font-semibold">{appName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">{topbarEnd}</div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

function SidebarContent({
  appName,
  appTagline,
  nav,
  footer,
  onNavigate,
}: {
  appName: string;
  appTagline: string;
  nav: NavGroup[];
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="px-5 pt-5 pb-4">
        <Logo tone="onDark" className="h-9" />
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded bg-cyan-brand px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-navy-950">{appName}</span>
          <span className="truncate text-xs text-navy-300">{appTagline}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={`Điều hướng ${appName}`}>
        {nav.map((group, i) => (
          <div key={group.label ?? i} className="mt-4 first:mt-1">
            {group.label && (
              <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-navy-400 uppercase">{group.label}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-navy-800 font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-cyan-brand'
                          : 'text-navy-200 hover:bg-navy-800/60 hover:text-white',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer && <div className="border-t border-navy-800 px-4 py-3 text-xs">{footer}</div>}
    </div>
  );
}
