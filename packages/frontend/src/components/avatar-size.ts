/**
 * The two sizes an avatar row is drawn at, as Tailwind classes.
 *
 * Their own module rather than constants inside `avatar-stack.tsx` because a
 * caller has to reserve the space an avatar *will* take before it exists —
 * `UserPresence` holds a slot open while its Yorkie document attaches — and
 * `react-refresh/only-export-components` lets a component file export scalar
 * constants but not object ones, which these are.
 */
export const AVATAR_SIZE_CLASS = {
  24: "h-6 w-6",
  32: "h-8 w-8",
} as const;

export const AVATAR_INITIALS_CLASS = {
  24: "text-2xs",
  32: "text-xs",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE_CLASS;

/**
 * The letters an avatar shows when it has no photo: the first letter of up to
 * two words of the name, so "Youngteac Hong" is "YH" and "hackerwins" is "H".
 *
 * One rule for every avatar of a person — the sidebar account menu, the
 * editor presence stack, the documents list and the notification rows. Each
 * of those used to derive its own (two of them took the first two letters,
 * one took word initials), so the same user read as "H" in one place and
 * "HA" in the next.
 *
 * Splits on `_` and `-` as well as whitespace because usernames here are
 * mostly logins. `Array.from` takes the first code point rather than the
 * first UTF-16 unit, so a name that starts with an astral character keeps it
 * whole. An empty name yields "?".
 */
export function avatarInitials(name: string): string {
  const initials = name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}
