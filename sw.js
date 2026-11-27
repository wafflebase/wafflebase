/*
 * Wafflebase app-shell service worker.
 *
 * Lets the app's own UI open with no network: the desktop app on a plane,
 * or a browser tab reopened while the server is down. It is deliberately
 * narrow (docs/design/frontend.md § Offline app shell):
 *
 * - Navigations are network-first. Whenever the server answers, its answer is
 *   used, whatever the status, so a deploy reaches users on their next load
 *   and nobody is held on an old build. A navigation that cannot reach the
 *   server, or gets no answer within NAVIGATION_TIMEOUT_MS while a cached shell
 *   exists, is answered with the cached `index.html`.
 * - `assets/` files are content-hashed by Vite, so they are cache-first: a
 *   name never changes content. The boot set is precached at install; every
 *   other chunk is cached the first time the app loads it, so an editor
 *   opened online once also opens offline.
 * - Everything else passes straight through untouched: other origins (the
 *   API, Yorkie, fonts), non-GET requests, the `/docs` site that shares this
 *   origin, and backend paths a same-origin deployment may serve. Nothing
 *   that carries a session or document content is ever stored.
 *
 * Plain JavaScript with no imports, so the file that ships is the file the
 * tests run (`tests/service-worker/sw.test.ts`). The build replaces the
 * manifest token below with this build's version, boot set and asset list
 * (`service-worker/plugin.ts`); a new deploy therefore changes this file's
 * bytes, which is what makes the browser install the new worker.
 */

/** @type {{ version: string, base: string, precache: string[], assets: string[] }} */
const MANIFEST = {"version":"e4fcb4a81da02c09","base":"/","precache":["/assets/PrivateRoute-3VzYHzly.js","/assets/index-B-ji8Xrt.js","/assets/index-BpoEA4RM.css","/assets/use-chat-stream-BSL0nTnN.js","/assets/vendor-app-OsArZuri.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-DmBtPEUp.js","/assets/vendor-yorkie-XlpMlXGa.js"],"assets":["/assets/AuthorAvatar-BzDl4fNT.js","/assets/CommentSidePanel-GuFNpPWP.js","/assets/CommentThreadCard-BlH32B_a.js","/assets/IconArrowDown-BkTyQ2b6.js","/assets/IconArrowUp-QLoj2Rdu.js","/assets/IconBorderAll-CYWmTFCZ.js","/assets/IconBrush-8TVhtsG2.js","/assets/IconChevronDown-CbA6geY-.js","/assets/IconChevronRight-CuT5SZnr.js","/assets/IconChevronUp-D5CdzIDB.js","/assets/IconCopy-CMjyXASG.js","/assets/IconCut-Cv05QukA.js","/assets/IconDownload-ChOueX1M.js","/assets/IconEye-COwoFrgG.js","/assets/IconEyeOff-D-SrK2i6.js","/assets/IconFileTypePdf-CkE9ICSK.js","/assets/IconHash-BlwJXPax.js","/assets/IconLink-DN8edbRX.js","/assets/IconList-x9i0FiZ-.js","/assets/IconListCheck-CkO9sgY7.js","/assets/IconLock-aoiM8NRY.js","/assets/IconMessagePlus-CE30gSmV.js","/assets/IconPencil-NNYMuWgx.js","/assets/IconPlayerPlay-c_n-hC34.js","/assets/IconPlus-CfTDAwbU.js","/assets/IconRowInsertTop-C-2_kYdp.js","/assets/IconTable-BVMwKJ8V.js","/assets/IconTrash-BWA7fBG3.js","/assets/IconUser-CIZ4NbyN.js","/assets/IconX-Dbn045xC.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-DPNg8-vg.js","/assets/PrivateRoute-3VzYHzly.js","/assets/abnfDiagram-VCTEODGH-Bg8GZNhj.js","/assets/alert-dialog-GnbVXz8P.js","/assets/analytics-Bib-Ef-J.js","/assets/apply-imported-content-Dwrkjkaa.js","/assets/arc-HCTFn2SN.js","/assets/architectureDiagram-5GKGNRK7-Cocfd_Bb.js","/assets/avatar-DD4vaXEp.js","/assets/avatar-stack-BuFthJHS.js","/assets/badge-uY0D8X8T.js","/assets/band-Cd7n_-Kq.js","/assets/band-numerics-HVTlKm-2.js","/assets/bar-chart-renderer-CG1mh7PL.js","/assets/blockDiagram-I7D4REHJ-Dj3Lxfn7.js","/assets/board-detail-B92dG5lp.js","/assets/board-document-CEA2ZoQj.js","/assets/board-export-S88J7bBM.js","/assets/board-follow-bridge-B3p-1jvX.js","/assets/board-view-BEQ0OrSg.js","/assets/c4Diagram-7LVT6UL2-DxCoz7NQ.js","/assets/channel-CEqSLg6x.js","/assets/chart-DqOqHL6_.js","/assets/chart-editor-panel-Dajml91z.js","/assets/chart-object-layer-CHSaifVx.js","/assets/chat-anchor-zoxwXYp4.js","/assets/chat-page-DlXANTjy.js","/assets/chat-panel-CfWnysZX.js","/assets/chat-panel-context-DdXMMcRt.js","/assets/chat-panel-slot-BLdqzjGc.js","/assets/checkbox-DL2VZqZ1.js","/assets/chunk-2Q5K7J3B-QFgi9IDX.js","/assets/chunk-5VM5RSS4-D_Me1NA1.js","/assets/chunk-F27PBJKO-B_spe-13.js","/assets/chunk-IMKFNOWR-8myQOYAy.js","/assets/chunk-JWPE2WC7-CpF7pfl_.js","/assets/chunk-POPQ4Y6H-IDioF5Vq.js","/assets/chunk-SVP7TREG-BAJowtka.js","/assets/chunk-TICWLB2K-DJZ7-ota.js","/assets/chunk-XXDRQBXY-Qf47E3tR.js","/assets/classDiagram-ZZMXUADV-CEm2r1eS.js","/assets/classDiagram-v2-VYDZK3BY-CyuNgNYf.js","/assets/code-language-packs-BOAXyaBT.js","/assets/color-swatch-button-BkJmtKck.js","/assets/conditional-format-panel-4nAfG-rQ.js","/assets/cose-bilkent-JH36ORCC-dJW1y7YC.js","/assets/createReactComponent-BpR-Ztjg.js","/assets/cynefin-OW5HDTMX-BbbUruIT.js","/assets/cynefinDiagram-5FMLGOSQ-BxtWOhWE.js","/assets/cytoscape.esm-BuSyQRDc.js","/assets/dagre-GXQ25YYZ-Bm_4UmlM.js","/assets/data-validation-panel-BkERuJOs.js","/assets/datasource-dialog-j7LYFYDv.js","/assets/datasource-selector--bJDZVay.js","/assets/datasource-view-DNIS2NlM.js","/assets/datasources-BBfuDViQ.js","/assets/date-cell-CW03X8al.js","/assets/date-format-preference-D0OiM91Q.js","/assets/default-light-DdomOcf7.js","/assets/defaultLocale-BkPkvnNA.js","/assets/diagram-S7CK7UJ4-C36w16Iz.js","/assets/diagram-UQ7AKVKN-Bw430wpQ.js","/assets/diagram-VSXAHHWV-DILJdBqb.js","/assets/diagram-VX7I27RA-CtIpwuw1.js","/assets/diagram-Z3DM3KII-BjZyvTYh.js","/assets/docs-detail-CSaB4qCU.js","/assets/docs-formatting-toolbar-Df8RQn0E.js","/assets/document-analytics-D-mAdcEv.js","/assets/document-detail-B0FrAXba.js","/assets/document-link-DNNICGrF.js","/assets/document-list-DxTvQEJP.js","/assets/document-list-utils-BqkSli9y.js","/assets/document-type-meta-D8ROBWV8.js","/assets/documents-L-j981wF.js","/assets/docx-actions-DPloKwnu.js","/assets/download-file-BcGydQ1I.js","/assets/draft-store-BHZnEtbp.js","/assets/dropdown-menu-BlxAmP0U.js","/assets/ebnfDiagram-PWID7BFC--PcucOSr.js","/assets/en_US-BatmKtou.js","/assets/en_US-DYmS30k3.js","/assets/erDiagram-RLTQ6QDP-BoosbyYG.js","/assets/export-utils-BpeLIQW7.js","/assets/file-detail-DWtgAbp0.js","/assets/file-meta-w6tD-olf.js","/assets/fit-to-content-DyJUkha1.js","/assets/flowDiagram-HODETNUW-6eQQRhb_.js","/assets/folders-BoxnL2R0.js","/assets/font-catalog.full-BrkBeDiT.js","/assets/font-files.data-D9ST9XM4.js","/assets/font-size-picker-CYv03uXT.js","/assets/footer-DC7n-Wjf.js","/assets/ganttDiagram-EL5Y4UJY-C95eyDQl.js","/assets/generic-file-view-60IsN4DF.js","/assets/gitGraphDiagram-WWUBYQGX-C9FjGw2i.js","/assets/group-channels-1Nt3pNJr.js","/assets/history-panel-Bw3KUDpP.js","/assets/image-cache-DPZTKp-Z.js","/assets/image-object-layer-BvQdXvTE.js","/assets/image-upload-kzFsTkRa.js","/assets/index-B-ji8Xrt.js","/assets/index-B7T74mdW.js","/assets/index-BpoEA4RM.css","/assets/index-CGJYeq32.js","/assets/index-CwtIrReV.js","/assets/index-uH3bXtDH.js","/assets/infoDiagram-27XIBGKW-xmH7PL_Z.js","/assets/init-Cq0Jqycp.js","/assets/input-B9YFBOUP.js","/assets/invite-accept-rkuWjBZH.js","/assets/ishikawaDiagram-5VMMS53U-Qkqm385t.js","/assets/journeyDiagram-3NMN7TZE-BfzGPnLa.js","/assets/kanban-definition-UXKFOSKX-coxZRuYQ.js","/assets/katex-DGG84gel.js","/assets/label-D3QhAzOt.js","/assets/lakehouse-feature-hFSwo72L.js","/assets/layout-9nt7-o76.js","/assets/layout-iXc-uAi-.js","/assets/linear-xBX5FIdd.js","/assets/load-error-state-CZTZZlqt.js","/assets/marketing-page-CldoqVSo.js","/assets/master-Dz2_o1l_.js","/assets/memory-DhSvlSHH.js","/assets/mentions-Ccc5Sw3d.js","/assets/mermaid.core-adVK1RaR.js","/assets/migrate-D91tvFBH.js","/assets/mindmap-definition-YA3MSWOX-0Q_XrVw6.js","/assets/mobile-slides-view-BKy9Ghab.js","/assets/notes-detail-BEDh4RhP.js","/assets/notes-editor-engine-CRgZDReJ.js","/assets/notes-toolbar-AH5yMNeL.js","/assets/notes-view-B2KwtNEO.js","/assets/ordinal-CLqi4UiQ.js","/assets/page-B967y8Rn.js","/assets/page-C3psIM-k.js","/assets/page-CFS4X74e.js","/assets/page-D1CYvlL_.js","/assets/page-DMJ7wrcu.js","/assets/page-K-9UnClK.js","/assets/pdf-CYzg2DJj.js","/assets/pdf-DfxA485i.js","/assets/pdf-actions-CTWK5hmy.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-DgwCoC8B.js","/assets/pieDiagram-E7YTZNPT-ClVTc8ML.js","/assets/pivot-editor-panel-BXzL5zzX.js","/assets/platform-BAfUWgVT.js","/assets/popover-BV7zcEzW.js","/assets/pptx-actions-oDIiaCqh.js","/assets/preview-surface-uLqV0ixM.js","/assets/public-templates-3PsvAITO.js","/assets/purify.es-im-3ebKh.js","/assets/quadrantDiagram-AXDQQJYC-DIvoHk15.js","/assets/radio-group-CafhPJSX.js","/assets/railroadDiagram-O6MQD6OU-BIRDeF5o.js","/assets/requirementDiagram-BXWQKSXE-CFPjZaQy.js","/assets/revision-preview-B2fWEhhK.js","/assets/ruler-backdrop-Be2zjl6c.js","/assets/sankeyDiagram-P5KCCOFB-CQmm8JvC.js","/assets/scroll-behavior-CLdxgR4r.js","/assets/section-D-15eAHG.js","/assets/section-head-9yh0TAQA.js","/assets/select-CdYdbM8d.js","/assets/send-to-chat-C_ZItXFh.js","/assets/send-to-chat-items-DU002aLE.js","/assets/separator-BjdueCN6.js","/assets/sequenceDiagram-WJ2MYXX4-CFb19zpJ.js","/assets/shape-BpkaQhhE.js","/assets/share-links-B9LE_L9D.js","/assets/shared-document-PgXzmEKP.js","/assets/sheet-core-BV2tDvAL.js","/assets/sheet-formula-eval-DOrey0Y8.js","/assets/sheet-formula-parser-C4L-X4xC.js","/assets/sheet-import-actions-17MM6VKU.js","/assets/sheet-view-Cg8E6sGv.js","/assets/shortcuts-help-dialog-bszaSL0G.js","/assets/side-panel-layout-D2g_oNZP.js","/assets/site-header-cPnPwiG8.js","/assets/sizeCapture-INFHLROL-V1nLWDpB.js","/assets/skeleton-BgkUlgfK.js","/assets/slider-D6a9xBLv.js","/assets/slides-detail-DD3cju7M.js","/assets/slides-editor-engine-DNSajHbc.js","/assets/slides-image-input-jK9jHmnh.js","/assets/slides-view-DutafjLc.js","/assets/stateDiagram-D77RDMKH-BnRUH7tR.js","/assets/stateDiagram-v2-MP3YSRHH-jVbbfc2E.js","/assets/string-CLQG8Dq2.js","/assets/swimlanes-42K2YHIH-DauoDjQI.js","/assets/swimlanesDiagram-VR7AAH4N-BZiGgfQx.js","/assets/switch-ClftfZkH.js","/assets/table-B-YD8_cN.js","/assets/table-grid-picker-BcM-rG3D.js","/assets/tabs-DiikscHF.js","/assets/template-category-items-2rCIU1gB.js","/assets/template-gallery-BMjjueRp.js","/assets/template-landing-DZwxM_GI.js","/assets/template-review-queue-DGYNwBXh.js","/assets/templates-BflZwOKI.js","/assets/text-edit-section-DKNF4c0A.js","/assets/textarea-CjicSfJJ.js","/assets/theme-panel-SrhgHE9t.js","/assets/theme-toggle-DKrum6JB.js","/assets/time-vkC2rxzr.js","/assets/timeline-definition-24CTP7MA-B0p_6gfx.js","/assets/toggle-bf1gTByI.js","/assets/toolbar-sMRrXs_m.js","/assets/trash-page-Byrm0UqS.js","/assets/upload-queue-D5fSYgQh.js","/assets/use-chat-BozZ_hy8.js","/assets/use-chat-stream-BSL0nTnN.js","/assets/use-coarse-pointer-DR6Qrnwh.js","/assets/use-mobile-sheet-gestures-C1aZvpja.js","/assets/use-object-layer-fWGzq8dQ.js","/assets/use-presence-updater-C1NeBJJ2.js","/assets/use-revision-history-o8QLeNlt.js","/assets/use-right-panels-9xwdCcQa.js","/assets/use-send-to-chat-D4Y7eO5T.js","/assets/use-workspace-members-Dkvvg-vf.js","/assets/use-workspace-nav-items-BNSRATGR.js","/assets/vendor-app-OsArZuri.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-DmBtPEUp.js","/assets/vendor-ui-history-Ca5rTyjX.js","/assets/vendor-yorkie-XlpMlXGa.js","/assets/vennDiagram-4TSXK5OY-BRkRzX4c.js","/assets/views-trend-chart-CS3gwOzn.js","/assets/waffle-logo-BhSrXS01.js","/assets/wardleyDiagram-VM6X3IG4-CoHV-Ihf.js","/assets/wb-button-BToB8x88.js","/assets/webhook-detail-page-Dd2WzSGw.js","/assets/webhooks-section-nxckEKBc.js","/assets/workspace-analytics-CEuFY5W6.js","/assets/workspace-documents-BWL3N3KO.js","/assets/workspace-settings-CF6MSVq4.js","/assets/workspace-templates-CzqmmWOE.js","/assets/xychartDiagram-S5SC5T6Z-NkEcqyiw.js","/assets/yield-B1UHNfma.js","/assets/yorkie-array-remove-Cg3rp9jf.js","/assets/yorkie-board-store-BX-YuToN.js","/assets/yorkie-doc-store-CR5wGNmB.js","/assets/yorkie-plain-z9UblpzR.js","/assets/yorkie-slides-store-ELnS8I7l.js","/assets/zoom-controller-Dwo3vNr1.js"]};

const SHELL_CACHE_PREFIX = "wafflebase-shell-";
const SHELL_CACHE = SHELL_CACHE_PREFIX + MANIFEST.version;
// Shared across versions: an unchanged chunk keeps its hash from one build to
// the next and need not be downloaded again. Pruned on activate instead.
const ASSET_CACHE = "wafflebase-assets";
const SHELL_KEY = MANIFEST.base + "index.html";
// How long a navigation waits for the server before the cached shell answers.
// A stalled connection (a TLS handshake that never completes) otherwise holds
// the navigation until the browser's own timeout, a minute or more; and the
// desktop shell, which needs a page to start loading within 3 s, would give
// up on a cache that was there all along (docs/design/desktop-app.md §2). The
// late network answer is not used: the next navigation gets the fresh build.
const NAVIGATION_TIMEOUT_MS = 2000;
const TIMED_OUT = Symbol("timed out");
const ASSET_PREFIX = MANIFEST.base + "assets/";

// Same-origin paths that are never the app: the VitePress site published
// under /docs, and backend routes on a deployment that serves the API from
// the frontend's own origin. Passed through, so a sign-in redirect or a
// cookie-setting response never runs through this worker's fetch.
const PASSTHROUGH_PREFIXES = ["docs/", "auth/", "api/", "internal/"].map(
  (p) => MANIFEST.base + p,
);

function isPassthroughPath(pathname) {
  if (pathname === MANIFEST.base + "docs") return true;
  return PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * What to do with a request: "navigate" (network-first, cached shell when
 * offline), "asset" (cache-first), or null (do not touch it at all).
 */
function classify(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (isPassthroughPath(url.pathname)) return null;
  if (request.mode === "navigate") return "navigate";
  if (url.pathname.startsWith(ASSET_PREFIX)) return "asset";
  return null;
}

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  // `reload` skips the HTTP cache: GitHub Pages serves index.html with a
  // ten-minute max-age, and a stale copy would name assets of the build
  // before this one.
  const response = await fetch(SHELL_KEY, { cache: "reload" });
  if (!response.ok) throw new Error(`shell fetch failed: ${response.status}`);
  // The shell comes from the server, the boot set from this worker's manifest.
  // A deploy that lands between the two would pair a new shell with the old
  // build's chunks, and that shell could not start offline. Refuse it: the
  // install fails and the previous worker keeps serving until the next one.
  // Every asset the shell names is cached with the boot set, so a shell that
  // preloads something the plugin left out of `precache` still starts offline.
  const html = await response.clone().text();
  const known = new Set(MANIFEST.assets);
  const escaped = ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const referenced = new RegExp(`["'](${escaped}[^"'?#]+)`, "g");
  const boot = new Set(MANIFEST.precache);
  for (const match of html.matchAll(referenced)) {
    if (!known.has(match[1])) {
      throw new Error(`shell references ${match[1]}, not part of this build`);
    }
    boot.add(match[1]);
  }
  const assets = await caches.open(ASSET_CACHE);
  await Promise.all(
    [...boot].map(async (path) => {
      if (await assets.match(path)) return;
      await assets.add(path);
    }),
  );
  // Last, so a worker whose boot set failed to download never answers an
  // offline navigation with a page that cannot start.
  await shell.put(SHELL_KEY, response);
}

async function cleanup() {
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE) {
      await caches.delete(name);
    }
  }
  // Drop chunks no longer part of the current build, or the cache would grow
  // by every build's lazily loaded chunks forever.
  const keep = new Set(MANIFEST.assets);
  const assets = await caches.open(ASSET_CACHE);
  for (const request of await assets.keys()) {
    if (!keep.has(new URL(request.url).pathname)) {
      await assets.delete(request);
    }
  }
}

async function handleNavigate(request) {
  const shell = await caches.open(SHELL_CACHE);
  const network = fetch(request);
  // Answered from cache after a timeout, the network's late result has no one
  // to report to; keep its rejection from surfacing as unhandled.
  network.catch(() => {});
  try {
    const first = await Promise.race([
      network,
      new Promise((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), NAVIGATION_TIMEOUT_MS),
      ),
    ]);
    if (first !== TIMED_OUT) return first;
    const cached = await shell.match(SHELL_KEY);
    // No cached shell: nothing better than waiting for the network.
    return cached ?? (await network);
  } catch (error) {
    const cached = await shell.match(SHELL_KEY);
    if (cached) return cached;
    throw error;
  }
}

async function handleAsset(request) {
  const assets = await caches.open(ASSET_CACHE);
  const cached = await assets.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    // Best effort: a full quota must not turn a chunk the network delivered
    // into a failed load. Only install's precache is all-or-nothing.
    try {
      await assets.put(request, response.clone());
    } catch {
      // Served uncached; the next load tries again.
    }
  }
  return response;
}

self.addEventListener("install", (event) => {
  // Taking over at once is safe because navigations are network-first: a
  // page from the previous build keeps fetching its own chunks, which miss
  // this cache and go to the network as they always did.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanup().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request);
  if (kind === "navigate") event.respondWith(handleNavigate(event.request));
  else if (kind === "asset") event.respondWith(handleAsset(event.request));
});
