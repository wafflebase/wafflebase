type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

export type KeyCombo = {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

const normalizeKey = (key: string): string =>
  key.length === 1 ? key.toLowerCase() : key;

/**
 * Returns true when the platform modifier is pressed (Cmd on macOS, Ctrl on
 * Windows/Linux). We intentionally treat either meta or ctrl as "mod" to make
 * shortcut checks platform-agnostic.
 */
export const isModPressed = (event: KeyEventLike): boolean =>
  event.metaKey || event.ctrlKey;

export const keyEquals = (event: KeyEventLike, key: string): boolean =>
  normalizeKey(event.key) === normalizeKey(key);

export const matchesKeyCombo = (
  event: KeyEventLike,
  combo: KeyCombo,
): boolean => {
  if (!keyEquals(event, combo.key)) {
    return false;
  }
  if (combo.mod !== undefined && isModPressed(event) !== combo.mod) {
    return false;
  }
  if (combo.shift !== undefined && event.shiftKey !== combo.shift) {
    return false;
  }
  if (combo.alt !== undefined && event.altKey !== combo.alt) {
    return false;
  }
  return true;
};

export type KeyRule = {
  match: (e: KeyboardEvent) => boolean;
  run: (e: KeyboardEvent) => Promise<void> | void;
};

export const runKeyRules = async (
  e: KeyboardEvent,
  rules: Array<KeyRule>,
): Promise<boolean> => {
  for (const rule of rules) {
    if (!rule.match(e)) continue;
    await rule.run(e);
    return true;
  }
  return false;
};

