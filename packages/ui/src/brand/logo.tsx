import { cn } from '../lib/cn';
import logoWhite from '../assets/logo-white.png';
import logoDark from '../assets/logo-dark.png';
import markWhite from '../assets/mark-white.png';
import markDark from '../assets/mark-dark.png';

interface BrandProps {
  /** `onDark`: nền navy/tối (logo trắng). `onLight`: nền sáng (logo đen). */
  tone?: 'onDark' | 'onLight';
  className?: string;
}

export function Logo({ tone = 'onLight', className }: BrandProps) {
  return (
    <img
      src={tone === 'onDark' ? logoWhite : logoDark}
      alt="Zero1 Technology"
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  );
}

export function LogoMark({ tone = 'onLight', className }: BrandProps) {
  return (
    <img
      src={tone === 'onDark' ? markWhite : markDark}
      alt="Zero1"
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  );
}
