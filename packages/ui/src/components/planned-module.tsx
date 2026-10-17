import { Construction } from 'lucide-react';
import { Badge } from './badge';
import { Card } from './card';

interface PlannedModuleProps {
  phase: number;
  features: string[];
}

/** Màn tạm cho module chưa làm: nói rõ giai đoạn và những gì sẽ có (docs/architecture.md §10). */
export function PlannedModule({ phase, features }: PlannedModuleProps) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="hidden size-11 shrink-0 items-center justify-center rounded-lg bg-cyan-brand-soft text-navy-900 sm:flex">
          <Construction className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <Badge tone="brand">Giai đoạn {phase}</Badge>
          <h2 className="mt-3 text-base font-semibold">Module đang được xây dựng</h2>
          <p className="mt-1 text-sm text-muted-foreground">Khi hoàn thành, màn hình này sẽ có:</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-brand" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
