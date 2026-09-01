/**
 * The two sizes an avatar row is drawn at, as Tailwind classes.
 *
 * Their own module rather than constants inside `avatar-stack.tsx` because a
 * caller has to reserve the space an avatar *will* take before it exists —
 * `UserPresence` holds a slot open while its Yorkie document attaches — and a
 * component file may not export non-components without breaking fast refresh.
 */
export const AVATAR_SIZE_CLASS = {
  24: "h-6 w-6",
  32: "h-8 w-8",
} as const;

export const AVATAR_INITIALS_CLASS = {
  24: "text-[10px]",
  32: "text-xs",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE_CLASS;
