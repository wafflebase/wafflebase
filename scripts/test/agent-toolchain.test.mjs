// The toolchain action's suite (`.github/actions/agent-toolchain/`), run by
// the `scripts:tests` lane on every pull request that reaches it.
//
// It lives beside the harness configuration it belongs to, in
// `.github/agent-harness/toolchain.test.mjs`. The shared harness's own
// `npm run test:repo` runs `repo.test.mjs` alone, under a 60-second limit
// this suite would use most of, so it is reached from here instead: in its
// own file, with its own limit, as `scripts/agent/install-deps.test.mjs` was
// before the install moved into the action.
await import("../../.github/agent-harness/toolchain.test.mjs");
