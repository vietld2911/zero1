import type { ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/cn';

export interface TabDef {
  value: string;
  label: ReactNode;
  content: ReactNode;
  hidden?: boolean;
}

interface TabsProps {
  tabs: TabDef[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, defaultValue, onValueChange, className }: TabsProps) {
  const visible = tabs.filter((t) => !t.hidden);
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue ?? visible[0]?.value}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsPrimitive.List className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {visible.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors',
              'hover:text-foreground data-[state=active]:border-cyan-brand data-[state=active]:text-foreground',
            )}
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {visible.map((t) => (
        <TabsPrimitive.Content key={t.value} value={t.value} className="outline-none">
          {t.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
