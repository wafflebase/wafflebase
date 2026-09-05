import { NotFoundException } from '@nestjs/common';
import { safeWorksheetRecordKeys } from '@wafflebase/sheets';

/**
 * Resolve a `:tabId` against a spreadsheet root's own tabs.
 *
 * Every tab-scoped v1 controller reaches `root.sheets[tabId]` with a `tabId`
 * that came straight off the URL (Express URL-decodes, so `%5F%5Fproto%5F%5F`
 * arrives as `__proto__`) or, for comment creation, out of the request body.
 * That value is both the existence check and the key that is written to, so a
 * truthiness test on the *value* is not enough:
 *
 * - On a **plain** object — a unit-test root, or any path not wrapped by a
 *   Yorkie proxy — `sheets['__proto__']` answers `Object.prototype`. Truthy,
 *   so `if (!worksheet)` passes and the subsequent `ws.images = {}` lands on
 *   the prototype instead of on a worksheet.
 * - On a **live Yorkie** object proxy — the only shape production sees — the
 *   get trap answers `getID` / `toJSON` / `toJS` / `toJSForTest` / `toString`
 *   with a *function*. Also truthy, so `.../tabs/toJSON/images` walked past the
 *   same guard and wrote caller data onto a non-worksheet object.
 *
 * A denylist of names closes only one of those halves. A membership test over
 * the record's real keys closes both, and is the check
 * `worksheet-structure.controller.ts` already used. `Object.hasOwn` and `in`
 * are unusable here: the proxy's `getOwnPropertyDescriptor` trap returns a
 * descriptor unconditionally and there is no `has` trap, so both misjudge a
 * real tab. The key list goes through the `ownKeys` trap, which returns the
 * CRDT object's actual keys, and is equally correct on a plain object.
 *
 * It reads that list through `safeWorksheetRecordKeys` rather than raw
 * `Object.keys`, which is what that helper exists for: `ownKeys` throws
 * `TypeError: ... duplicate` on a record that ended up with duplicate CRDT
 * keys, and a tab lookup that throws would 500 every request on such a
 * document instead of resolving the tab.
 */
export function findWorksheet<T = Record<string, unknown>>(
  root: { sheets?: Record<string, unknown> } | undefined,
  tabId: string,
): T | undefined {
  const sheets = root?.sheets;
  if (!sheets || !safeWorksheetRecordKeys(sheets).includes(tabId)) {
    return undefined;
  }
  return sheets[tabId] as T | undefined;
}

/**
 * `findWorksheet`, answering `404 Tab not found` when the id is not one of the
 * document's tabs — including the inherited and proxy-trap names above, for
 * which "not found" is the truthful answer: no tab has those ids.
 */
export function worksheetOrThrow<T = Record<string, unknown>>(
  root: { sheets?: Record<string, unknown> } | undefined,
  tabId: string,
): T {
  const worksheet = findWorksheet<T>(root, tabId);
  if (!worksheet) throw new NotFoundException('Tab not found');
  return worksheet;
}
