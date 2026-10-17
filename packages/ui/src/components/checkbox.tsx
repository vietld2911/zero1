import type { ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, label, className, ...rest }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={rest['aria-label']}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border border-navy-300 bg-surface transition-colors',
        'data-[state=checked]:border-navy-900 data-[state=checked]:bg-navy-900 data-[state=checked]:text-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
        !label && className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      {box}
      <span>{label}</span>
    </label>
  );
}
