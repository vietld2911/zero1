import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './input';

const fmt = new Intl.NumberFormat('vi-VN');

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}

/** Ô nhập tiền VNĐ: hiển thị 12.000.000, giá trị là số nguyên (null khi để trống). */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput({ value, onChange, ...props }, ref) {
  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        value={value == null ? '' : fmt.format(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          onChange(digits ? Math.min(Number(digits), Number.MAX_SAFE_INTEGER) : null);
        }}
        className="pr-8 text-right tabular-nums"
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">đ</span>
    </div>
  );
});
