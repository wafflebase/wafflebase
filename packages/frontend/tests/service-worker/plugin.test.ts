import { describe, expect, test } from "vitest";
import type { Rollup } from "vite";
import {
  buildManifest,
  isServiceWorkerEnabled,
  renderServiceWorker,
} from "../../service-worker/plugin";

function chunk(
  fileName: string,
  fields: {
    isEntry?: boolean;
    facadeModuleId?: string | null;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
  } = {},
) {
  return {
    type: "chunk",
    fileName,
    isEntry: fields.isEntry ?? false,
    facadeModuleId: fields.facadeModuleId ?? null,
    imports: fields.imports ?? [],
    dynamicImports: fields.dynamicImports ?? [],
    viteMetadata: {
      importedCss: new Set(fields.css ?? []),
      importedAssets: new Set(),
    },
  } as unknown as Rollup.OutputChunk;
}

function asset(fileName: string) {
  return { type: "asset", fileName, source: "" } as unknown as Rollup.OutputAsset;
}

const bundle: Rollup.OutputBundle = {
  "assets/index-1.js": chunk("assets/index-1.js", {
    isEntry: true,
    facadeModuleId: "/repo/packages/frontend/index.html",
    imports: ["assets/vendor-react-2.js"],
    dynamicImports: ["assets/PrivateRoute-3.js", "assets/sheet-view-5.js"],
    css: ["assets/index-1.css"],
  }),
  "assets/vendor-react-2.js": chunk("assets/vendor-react-2.js"),
  "assets/PrivateRoute-3.js": chunk("assets/PrivateRoute-3.js", {
    facadeModuleId: "/repo/packages/frontend/src/PrivateRoute.tsx",
    imports: ["assets/vendor-yorkie-4.js", "assets/vendor-react-2.js"],
  }),
  "assets/vendor-yorkie-4.js": chunk("assets/vendor-yorkie-4.js"),
  "assets/sheet-view-5.js": chunk("assets/sheet-view-5.js", {
    facadeModuleId: "/repo/packages/frontend/src/app/spreadsheet/sheet-view.tsx",
  }),
  "assets/index-1.css": asset("assets/index-1.css"),
  "assets/index-1.js.map": asset("assets/index-1.js.map"),
  "index.html": asset("index.html"),
  "icon.svg": asset("icon.svg"),
};

const options = {
  base: "/",
  bootModules: ["/src/PrivateRoute.tsx"],
  indexHtml: "<html>v1</html>",
};

describe("buildManifest", () => {
  test("precaches the entry's static closure and the boot modules, not lazy editors", () => {
    expect(buildManifest(bundle, options).precache).toEqual([
      "/assets/PrivateRoute-3.js",
      "/assets/index-1.css",
      "/assets/index-1.js",
      "/assets/vendor-react-2.js",
      "/assets/vendor-yorkie-4.js",
    ]);
  });

  test("lists every hashed asset but no source maps or root files", () => {
    expect(buildManifest(bundle, options).assets).toEqual([
      "/assets/PrivateRoute-3.js",
      "/assets/index-1.css",
      "/assets/index-1.js",
      "/assets/sheet-view-5.js",
      "/assets/vendor-react-2.js",
      "/assets/vendor-yorkie-4.js",
    ]);
  });

  test("the version changes with index.html even when no asset does", () => {
    const a = buildManifest(bundle, options).version;
    const b = buildManifest(bundle, { ...options, indexHtml: "<html>v2</html>" })
      .version;
    expect(a).not.toBe(b);
    expect(buildManifest(bundle, options).version).toBe(a);
  });

  test("prefixes paths with a non-root base", () => {
    const m = buildManifest(bundle, { ...options, base: "/app/" });
    expect(m.precache).toContain("/app/assets/index-1.js");
    expect(m.base).toBe("/app/");
  });
});

describe("renderServiceWorker", () => {
  test("replaces the manifest token", () => {
    const out = renderServiceWorker("const M = __WB_SW_MANIFEST__;", {
      version: "x",
      base: "/",
      precache: [],
      assets: [],
    });
    expect(out).toBe(
      'const M = {"version":"x","base":"/","precache":[],"assets":[]};',
    );
  });

  test("refuses a source without the token", () => {
    expect(() =>
      renderServiceWorker("nothing", {
        version: "x",
        base: "/",
        precache: [],
        assets: [],
      }),
    ).toThrow(/__WB_SW_MANIFEST__/);
  });
});

test.each([
  [undefined, true],
  ["", true],
  ["on", true],
  ["off", false],
  [" OFF ", false],
])("VITE_SERVICE_WORKER=%j keeps the worker on: %s", (value, expected) => {
  expect(isServiceWorkerEnabled(value)).toBe(expected);
});
