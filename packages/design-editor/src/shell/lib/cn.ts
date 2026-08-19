/**
 * `cn()` — the class-merging helper every shadcn component calls.
 *
 * LOCAL, NOT THE CONSUMER'S. The prototype's chrome imported this from
 * `@/lib/utils`, which is §6's coupling in its purest form: a generic panel
 * reaching into the consumer's source tree for a three-line utility. A project
 * whose alias is `~` resolved nothing; a project that never scaffolded shadcn has
 * no `lib/utils` at all.
 *
 * `clsx` + `tailwind-merge` rather than a hand-rolled join, because the panels
 * compose conditional Tailwind classes that genuinely conflict (`p-2` from a base
 * and `p-4` from a variant) and last-wins requires knowing which utilities are in
 * the same group. Both are bundled into the prebuilt shell, so the consumer never
 * installs them.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
