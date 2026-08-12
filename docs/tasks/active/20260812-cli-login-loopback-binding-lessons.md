# Lessons — CLI login: bind the loopback callback (nonce echo + PKCE)

Related: #654/#655, RFC 8252 §8.9, RFC 7636

## Notes

- The nonce echo and PKCE look redundant and are not. The nonce protects
  the *client* (the CLI refuses a code that is not from its own flow); PKCE
  protects the *code* (nobody but the CLI can redeem it, wherever it
  leaked). Either alone leaves the other hole open, and both are cheap:
  two `randomBytes` calls and one hash.
- Half of a two-sided protocol change is worse than none. The first attempt
  made the CLI *require* an echo only the new backend sends, which turned a
  login against any older or self-hosted server into a 30-second silence
  ending in "Login timed out." Both parameters are optional on the wire
  now, and the one case that still cannot be accepted — a code with no
  `state` at all — says *why* on timeout instead of blaming the clock.
- A rejected callback must not settle the promise. Answering `400` and
  leaving the listener open is what keeps an attacker's probe from being a
  denial of service against a genuine login that has not arrived yet.
- Testing the callback gate is not enough: nothing there proves the CLI
  ever *sends* `nonce=`. `test/login-callback.test.ts` therefore drives the
  real `registerLoginCommand` action — `open` mocked, `fetch` stubbed
  except for 127.0.0.1, `WAFFLEBASE_SESSION` pointed at a temp file — and
  reads the OAuth URL back off the notice the command prints. That is the
  only assertion that would catch the parameter being renamed.
- A mismatch test has to defeat the short-circuit. `nonceMatches` is
  `length === length && timingSafeEqual`, so "no state" and a shorter wrong
  state both stop at the length check and never exercise the comparison. A
  same-length wrong nonce is the case that fails if the body degrades to a
  length compare.
- Stubbing passport in a guard spec: `jest.spyOn(Object.getPrototypeOf(
  GitHubAuthGuard.prototype), 'canActivate')`. The mixin `AuthGuard('github')`
  returns *is* the prototype chain link, so this replaces the redirect
  machinery without a module mock.
