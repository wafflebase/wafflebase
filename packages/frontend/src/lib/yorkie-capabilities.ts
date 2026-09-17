/**
 * What this build's `@yorkie-js/react` can actually do.
 *
 * One capability so far, and it is a hard precondition for offline
 * persistence rather than a nicety.
 */

/**
 * The first `@yorkie-js/react` whose `YorkieProvider` forwards a client key.
 *
 * `YorkieProviderProps` is `ClientOptions`, whose client key is spelled `key` —
 * and React reserves that name, stripping it at element creation as a JSX
 * attribute and through a spread alike. So before this version a
 * provider-mounted client could not be given an explicit key **at all**
 * (yorkie-js-sdk#1357 adds a `clientKey` prop).
 *
 * That is not cosmetic here. The SDK's `DocStore` is keyed by
 * `apiKey/clientKey/docKey`, so a client whose key is minted randomly per
 * session writes to a fresh scope on every page load and resumes nothing.
 * Going durable anyway would mean a store filling with entries no reload can
 * use, and a sync chip promising a durability that does not survive one — the
 * kind of false promise this feature exists to avoid making.
 */
export const MinClientKeyVersion = "0.7.23";

/**
 * `a >= b` for plain `x.y.z` releases, refusing anything else.
 *
 * A prerelease is refused rather than compared. `0.7.23-beta.1` is a reachable
 * pin — Vite injects the specifier verbatim — and a loose parse reads it as
 * `[0, 7, 23, 1]`, which is *newer* than the required release. That would open
 * the gate on a build that may not carry the prop at all, leaving the store
 * under a key the SDK minted at random and unable to resume. The whole point of
 * the gate is to be wrong in the other direction.
 */
function atLeast(a: string, b: string): boolean {
  const release = /^[\^~>=<\s]*(\d+)\.(\d+)\.(\d+)\s*$/;
  const left = release.exec(a);
  const right = release.exec(b);
  if (!left || !right) {
    return false;
  }
  for (let i = 1; i <= 3; i++) {
    const l = Number.parseInt(left[i], 10);
    const r = Number.parseInt(right[i], 10);
    if (l !== r) return l > r;
  }
  return true;
}

/**
 * Whether the pinned `@yorkie-js/react` can be given a client key.
 *
 * Read from the dependency pin at build time rather than probed at runtime,
 * because the answer has to be known *before* a client is constructed: by the
 * time one exists, it exists with or without our key and with the store
 * already attached.
 *
 * Bumping the dependency is the only action needed to turn the feature on.
 */
export function supportsClientKey(): boolean {
  const version =
    typeof __YORKIE_REACT_VERSION__ === "string"
      ? __YORKIE_REACT_VERSION__
      : "0.0.0";
  return atLeast(version, MinClientKeyVersion);
}
