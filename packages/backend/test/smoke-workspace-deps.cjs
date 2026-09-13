'use strict';

// Module-resolution smoke for the production backend image
// (CI: verify-backend-image).
//
// It `require`s every `@wafflebase/*` package the backend declares as a
// dependency, from the backend's own directory, so it exercises the exact
// resolution the server performs at boot: the package's `exports` map under
// the `node` + `require` conditions, and then the file that map points at.
//
// This exists because the image can be missing a package's `dist/` and still
// build, test and push green. The runtime stage copies each workspace
// package's `package.json` but copies `dist/` per package by hand, so a new
// backend dependency needs a matching `COPY --from=builder` line and nothing
// fails if it is forgotten. v0.6.10 shipped without
// `packages/slides/dist` and crash-looped on boot with
// `Cannot find module '/app/packages/backend/node_modules/@wafflebase/slides/dist/node.cjs'`.
//
// The list is read from `package.json` rather than hard-coded, so a dependency
// added later is covered without anyone remembering to extend this file — the
// omission that caused the outage in the first place.
//
// Usage (from /app/packages/backend inside the image):
//   node test/smoke-workspace-deps.cjs

const path = require('node:path');

function main() {
  const manifest = require(path.join(__dirname, '..', 'package.json'));
  const specifiers = Object.keys(manifest.dependencies || {})
    .filter((name) => name.startsWith('@wafflebase/'))
    .sort();

  if (specifiers.length === 0) {
    throw new Error(
      'No @wafflebase/* dependencies found in packages/backend/package.json. ' +
        'Either the manifest was not copied into the image, or this smoke is ' +
        'now asserting nothing — both are failures.',
    );
  }

  const failures = [];
  for (const specifier of specifiers) {
    try {
      const resolved = require.resolve(specifier);
      require(specifier);
      console.log(`ok  ${specifier} -> ${resolved}`);
    } catch (err) {
      failures.push({ specifier, err });
      console.error(`FAIL ${specifier}: ${err && err.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${specifiers.length} workspace dependencies did ` +
        'not load inside the image. A MODULE_NOT_FOUND on a `dist/` path means ' +
        'the Dockerfile runtime stage is missing a ' +
        '`COPY --from=builder /app/packages/<name>/dist` line.',
    );
  }

  console.log(
    `\n${specifiers.length} workspace dependencies resolved and loaded.`,
  );
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
