/*
 * A CVA component, for the class-rewrite half of the gate.
 *
 * `cva` is imported but never installed: nothing in this fixture is ever executed
 * or bundled. The plugin reads these files with its own parser — that is the whole
 * of what a consumer's component is to it — so the import exists to make the source
 * honest, not to resolve.
 */
import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        destructive: 'border-transparent bg-destructive text-primary-foreground',
      },
      size: {
        sm: 'h-5 text-[0.6875rem]',
        md: 'h-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export function Badge({ className, children }: { className?: string; children?: unknown }) {
  return <span className={className}>{children}</span>;
}
