import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Vạch ngăn trước mục này. */
  separatorBefore?: boolean;
}

interface DropdownMenuProps {
  trigger: ReactNode;
  actions: MenuAction[];
  header?: ReactNode;
  align?: 'start' | 'end';
}

export function DropdownMenu({ trigger, actions, header, align = 'end' }: DropdownMenuProps) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {header && <div className="border-b border-border px-2.5 pt-1.5 pb-2 text-sm">{header}</div>}
          {actions.map((a) => (
            <div key={a.label}>
              {a.separatorBefore && <Menu.Separator className="my-1 h-px bg-border" />}
              <Menu.Item
                disabled={a.disabled}
                onSelect={a.onSelect}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm outline-none select-none',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted',
                  a.tone === 'danger' && 'text-danger',
                )}
              >
                {a.icon && <a.icon className="size-4" aria-hidden />}
                {a.label}
              </Menu.Item>
            </div>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
