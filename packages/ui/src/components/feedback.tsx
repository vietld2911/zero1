import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { Toaster as SonnerToaster } from 'sonner';
import { cn } from '../lib/cn';

export { toast } from 'sonner';

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? <span className="sr-only">Đang tải</span>}
    </span>
  );
}

const alertTones = {
  info: { box: 'border-info/20 bg-info-soft text-info', icon: Info },
  success: { box: 'border-success/20 bg-success-soft text-success', icon: CheckCircle2 },
  warning: { box: 'border-warning/20 bg-warning-soft text-warning', icon: AlertTriangle },
  danger: { box: 'border-danger/20 bg-danger-soft text-danger', icon: XCircle },
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof alertTones;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = alertTones[tone];
  return (
    <div className={cn('flex gap-3 rounded-md border px-3.5 py-3 text-sm', box, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-foreground/80')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{ style: { fontFamily: 'inherit' } }}
    />
  );
}
