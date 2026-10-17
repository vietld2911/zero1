import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

/** Link quay lại trang danh sách, đặt trên PageHeader của trang chi tiết. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
