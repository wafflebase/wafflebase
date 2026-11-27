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
const MANIFEST = {"version":"d50f7f023a4c96c7","base":"/","precache":["/assets/PrivateRoute-CUOfToRa.js","/assets/index-6THGt2DT.css","/assets/index-EpF0-p7q.js","/assets/use-chat-stream-CSDWPZoz.js","/assets/vendor-app-OsArZuri.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-DNCDNnA7.js","/assets/vendor-yorkie-XlpMlXGa.js"],"assets":["/assets/AuthorAvatar-dGzah3HW.js","/assets/CommentSidePanel-BQjhbyPK.js","/assets/CommentThreadCard-Bj1sgzzw.js","/assets/IconArrowDown-BkTyQ2b6.js","/assets/IconArrowUp-QLoj2Rdu.js","/assets/IconBorderAll-CYWmTFCZ.js","/assets/IconBrush-8TVhtsG2.js","/assets/IconChevronDown-CbA6geY-.js","/assets/IconChevronRight-CuT5SZnr.js","/assets/IconChevronUp-D5CdzIDB.js","/assets/IconCopy-CMjyXASG.js","/assets/IconCut-Cv05QukA.js","/assets/IconDownload-ChOueX1M.js","/assets/IconEye-COwoFrgG.js","/assets/IconEyeOff-D-SrK2i6.js","/assets/IconFileTypePdf-CkE9ICSK.js","/assets/IconHash-BlwJXPax.js","/assets/IconLink-DN8edbRX.js","/assets/IconList-x9i0FiZ-.js","/assets/IconListCheck-CkO9sgY7.js","/assets/IconLock-aoiM8NRY.js","/assets/IconMessagePlus-CE30gSmV.js","/assets/IconPencil-NNYMuWgx.js","/assets/IconPlayerPlay-c_n-hC34.js","/assets/IconPlus-CfTDAwbU.js","/assets/IconRowInsertTop-C-2_kYdp.js","/assets/IconTable-BVMwKJ8V.js","/assets/IconTrash-BWA7fBG3.js","/assets/IconUser-CIZ4NbyN.js","/assets/IconX-Dbn045xC.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-0oFtG2dy.js","/assets/PrivateRoute-CUOfToRa.js","/assets/abnfDiagram-VCTEODGH-Bg8GZNhj.js","/assets/alert-dialog-CV9uD0Yi.js","/assets/analytics-fwLBneS3.js","/assets/apply-imported-content-C9jes2DM.js","/assets/arc-HCTFn2SN.js","/assets/architectureDiagram-5GKGNRK7-Cocfd_Bb.js","/assets/avatar-Dg5T9k5O.js","/assets/avatar-stack-Bllw2oPy.js","/assets/badge-CG9RrYNa.js","/assets/band-Cd7n_-Kq.js","/assets/band-numerics-HVTlKm-2.js","/assets/bar-chart-renderer-CXpFn5vz.js","/assets/blockDiagram-I7D4REHJ-Dj3Lxfn7.js","/assets/board-detail-DVjjpFz7.js","/assets/board-document-CEA2ZoQj.js","/assets/board-export-CZEScpiA.js","/assets/board-follow-bridge-B3p-1jvX.js","/assets/board-view-BBwIJzTc.js","/assets/c4Diagram-7LVT6UL2-DxCoz7NQ.js","/assets/channel-CEqSLg6x.js","/assets/chart-BElEsc6g.js","/assets/chart-editor-panel-BgMlCrlc.js","/assets/chart-object-layer-CE3ey9_q.js","/assets/chat-anchor-Cq3a0bcd.js","/assets/chat-page-fRhGu3mW.js","/assets/chat-panel-CN08AZw4.js","/assets/chat-panel-context-D8OwE_ZK.js","/assets/chat-panel-slot-D6Bn1pON.js","/assets/checkbox-D80yJrEm.js","/assets/chunk-2Q5K7J3B-QFgi9IDX.js","/assets/chunk-5VM5RSS4-D_Me1NA1.js","/assets/chunk-F27PBJKO-B_spe-13.js","/assets/chunk-IMKFNOWR-8myQOYAy.js","/assets/chunk-JWPE2WC7-CpF7pfl_.js","/assets/chunk-POPQ4Y6H-IDioF5Vq.js","/assets/chunk-SVP7TREG-BAJowtka.js","/assets/chunk-TICWLB2K-DJZ7-ota.js","/assets/chunk-XXDRQBXY-Qf47E3tR.js","/assets/classDiagram-ZZMXUADV-CEm2r1eS.js","/assets/classDiagram-v2-VYDZK3BY-CyuNgNYf.js","/assets/code-language-packs-BOAXyaBT.js","/assets/color-swatch-button-CsJIa4cm.js","/assets/conditional-format-panel-DUiu-Sb_.js","/assets/cose-bilkent-JH36ORCC-dJW1y7YC.js","/assets/createReactComponent-BpR-Ztjg.js","/assets/cynefin-OW5HDTMX-BbbUruIT.js","/assets/cynefinDiagram-5FMLGOSQ-BxtWOhWE.js","/assets/cytoscape.esm-BuSyQRDc.js","/assets/dagre-GXQ25YYZ-Bm_4UmlM.js","/assets/data-validation-panel-tVkrl4L6.js","/assets/datasource-dialog-Cyp-8KLw.js","/assets/datasource-selector-BfIFBIKZ.js","/assets/datasource-view-gd8qrUiT.js","/assets/datasources-emlQR25E.js","/assets/date-cell-CW03X8al.js","/assets/date-format-preference-D0OiM91Q.js","/assets/default-light-DdomOcf7.js","/assets/defaultLocale-BkPkvnNA.js","/assets/diagram-S7CK7UJ4-C36w16Iz.js","/assets/diagram-UQ7AKVKN-Bw430wpQ.js","/assets/diagram-VSXAHHWV-DILJdBqb.js","/assets/diagram-VX7I27RA-CtIpwuw1.js","/assets/diagram-Z3DM3KII-BjZyvTYh.js","/assets/docs-detail-DGerumUe.js","/assets/docs-formatting-toolbar-DZFVILGp.js","/assets/document-analytics-CO3tuciU.js","/assets/document-detail-CnHAl_ef.js","/assets/document-link-DNNICGrF.js","/assets/document-list-C1MBV5V7.js","/assets/document-list-utils-BqkSli9y.js","/assets/document-type-meta-NE1DxPcz.js","/assets/documents-CaT_3ADv.js","/assets/docx-actions-BNtxwlID.js","/assets/download-file-Ba4CPJ3w.js","/assets/draft-store-BHZnEtbp.js","/assets/dropdown-menu-CDtteVxr.js","/assets/ebnfDiagram-PWID7BFC--PcucOSr.js","/assets/en_US-BatmKtou.js","/assets/en_US-DYmS30k3.js","/assets/erDiagram-RLTQ6QDP-BoosbyYG.js","/assets/export-utils-CDZh5DOR.js","/assets/file-detail-BwC0K357.js","/assets/file-meta-B9ZGN-v7.js","/assets/fit-to-content-DyJUkha1.js","/assets/flowDiagram-HODETNUW-6eQQRhb_.js","/assets/folders-B1Zn_siq.js","/assets/font-catalog.full-BrkBeDiT.js","/assets/font-files.data-D9ST9XM4.js","/assets/font-size-picker-CmQzMffh.js","/assets/footer-DI3ZXzvQ.js","/assets/ganttDiagram-EL5Y4UJY-C95eyDQl.js","/assets/generic-file-view-Bx8z6EtB.js","/assets/gitGraphDiagram-WWUBYQGX-C9FjGw2i.js","/assets/group-channels-C2wMi4nw.js","/assets/history-panel-CpN7D3A7.js","/assets/image-cache-DPZTKp-Z.js","/assets/image-object-layer-BvQdXvTE.js","/assets/image-upload-CnlwqWjZ.js","/assets/index-6THGt2DT.css","/assets/index-7eYfv9NG.js","/assets/index-B7T74mdW.js","/assets/index-C4o_TelJ.js","/assets/index-CNSLfH72.js","/assets/index-EpF0-p7q.js","/assets/infoDiagram-27XIBGKW-xmH7PL_Z.js","/assets/init-Cq0Jqycp.js","/assets/input-BWpUFc0c.js","/assets/invite-accept-D2JP8kcW.js","/assets/ishikawaDiagram-5VMMS53U-Qkqm385t.js","/assets/journeyDiagram-3NMN7TZE-BfzGPnLa.js","/assets/kanban-definition-UXKFOSKX-coxZRuYQ.js","/assets/katex-DGG84gel.js","/assets/label-DuMyAzce.js","/assets/lakehouse-feature-Dyid-p2z.js","/assets/layout-9nt7-o76.js","/assets/layout-iXc-uAi-.js","/assets/linear-xBX5FIdd.js","/assets/load-error-state-CWBngkDS.js","/assets/marketing-page-Cxr7vqB2.js","/assets/master-Dz2_o1l_.js","/assets/memory-DhSvlSHH.js","/assets/mentions-CVJtZt8V.js","/assets/mermaid.core-adVK1RaR.js","/assets/migrate-D91tvFBH.js","/assets/mindmap-definition-YA3MSWOX-0Q_XrVw6.js","/assets/mobile-slides-view-CYuae_Uc.js","/assets/notes-detail-Bes8Gqzb.js","/assets/notes-editor-engine-CRgZDReJ.js","/assets/notes-toolbar-DtBq_r-N.js","/assets/notes-view-BuMULjb-.js","/assets/ordinal-CLqi4UiQ.js","/assets/page-BJ2NBh3E.js","/assets/page-C3psIM-k.js","/assets/page-CIYgxySC.js","/assets/page-Cb20Lqu8.js","/assets/page-DVFnaVrZ.js","/assets/page-DciOjuH9.js","/assets/pdf-CYzg2DJj.js","/assets/pdf-DfxA485i.js","/assets/pdf-actions-Ad9M5xsj.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-DgwCoC8B.js","/assets/pieDiagram-E7YTZNPT-ClVTc8ML.js","/assets/pivot-editor-panel-Cx8DrM-h.js","/assets/platform-BAfUWgVT.js","/assets/popover-CeV7Ymqj.js","/assets/pptx-actions-DUaoNA-w.js","/assets/preview-surface-CtD9Mk-c.js","/assets/public-templates-DuXOUkn4.js","/assets/purify.es-im-3ebKh.js","/assets/quadrantDiagram-AXDQQJYC-DIvoHk15.js","/assets/radio-group-np2rUd0V.js","/assets/railroadDiagram-O6MQD6OU-BIRDeF5o.js","/assets/requirementDiagram-BXWQKSXE-CFPjZaQy.js","/assets/revision-preview-CztZ0vZx.js","/assets/ruler-backdrop-ljWQnxcc.js","/assets/sankeyDiagram-P5KCCOFB-CQmm8JvC.js","/assets/scroll-behavior-CLdxgR4r.js","/assets/section-D-15eAHG.js","/assets/section-head-BYx1KpO7.js","/assets/select-Dg8qXj5l.js","/assets/send-to-chat-C_ZItXFh.js","/assets/send-to-chat-items-DU002aLE.js","/assets/separator-uqMj9Tnk.js","/assets/sequenceDiagram-WJ2MYXX4-CFb19zpJ.js","/assets/shape-BpkaQhhE.js","/assets/share-links-b_OWMojb.js","/assets/shared-document-DmT6ovAs.js","/assets/sheet-core-BV2tDvAL.js","/assets/sheet-formula-eval-DOrey0Y8.js","/assets/sheet-formula-parser-C4L-X4xC.js","/assets/sheet-import-actions-C1BLnAtX.js","/assets/sheet-view-DMk81KB6.js","/assets/shortcuts-help-dialog-G4XQQTbT.js","/assets/side-panel-layout-D2g_oNZP.js","/assets/site-header-CwHDt935.js","/assets/sizeCapture-INFHLROL-V1nLWDpB.js","/assets/skeleton-DsUInuwe.js","/assets/slider-Cqk4nqo9.js","/assets/slides-detail-BcLWGXuC.js","/assets/slides-editor-engine-DNSajHbc.js","/assets/slides-image-input-D7jhyylG.js","/assets/slides-view-CCZ64hzZ.js","/assets/stateDiagram-D77RDMKH-BnRUH7tR.js","/assets/stateDiagram-v2-MP3YSRHH-jVbbfc2E.js","/assets/string-CLQG8Dq2.js","/assets/swimlanes-42K2YHIH-DauoDjQI.js","/assets/swimlanesDiagram-VR7AAH4N-BZiGgfQx.js","/assets/switch-DsfcWm7b.js","/assets/table-DYqwouXn.js","/assets/table-grid-picker-BcM-rG3D.js","/assets/tabs-nBC4QO7q.js","/assets/template-category-items-Dn5645fi.js","/assets/template-gallery-BntXKfYp.js","/assets/template-landing-B2UXJo-l.js","/assets/template-review-queue-C3bQHZCO.js","/assets/templates-Dqqe1rDT.js","/assets/text-edit-section-CX9TGMmm.js","/assets/textarea-DiQRV6uh.js","/assets/theme-panel-dPK4vYBb.js","/assets/theme-toggle-DMK1i94p.js","/assets/time-vkC2rxzr.js","/assets/timeline-definition-24CTP7MA-B0p_6gfx.js","/assets/toggle-ClfiMy2F.js","/assets/toolbar-WKSdA24A.js","/assets/trash-page-DgaxCXUH.js","/assets/upload-queue-C6uREvJ3.js","/assets/use-chat-BBoV7wJY.js","/assets/use-chat-stream-CSDWPZoz.js","/assets/use-coarse-pointer-DR6Qrnwh.js","/assets/use-mobile-sheet-gestures-BR-uT9h9.js","/assets/use-object-layer-fWGzq8dQ.js","/assets/use-presence-updater-Dl3_qPwx.js","/assets/use-revision-history-CSBIPliC.js","/assets/use-right-panels-9xwdCcQa.js","/assets/use-send-to-chat-CHMeauAk.js","/assets/use-workspace-members-BinFiliA.js","/assets/use-workspace-nav-items-KufR2UyD.js","/assets/vendor-app-OsArZuri.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-DNCDNnA7.js","/assets/vendor-ui-history-D7Jm-qPI.js","/assets/vendor-yorkie-XlpMlXGa.js","/assets/vennDiagram-4TSXK5OY-BRkRzX4c.js","/assets/views-trend-chart-DNvpEIai.js","/assets/waffle-logo-BhSrXS01.js","/assets/wardleyDiagram-VM6X3IG4-CoHV-Ihf.js","/assets/wb-button-DnK3Qimm.js","/assets/webhook-detail-page-5tQz_K81.js","/assets/webhooks-section-Blu-tvFr.js","/assets/workspace-analytics-DPMOE2L3.js","/assets/workspace-documents-BYF5Xkyl.js","/assets/workspace-settings-FKM6sAO2.js","/assets/workspace-templates-D9VC4cWF.js","/assets/xychartDiagram-S5SC5T6Z-NkEcqyiw.js","/assets/yield-B1UHNfma.js","/assets/yorkie-array-remove-Cg3rp9jf.js","/assets/yorkie-board-store-BX-YuToN.js","/assets/yorkie-doc-store-CR5wGNmB.js","/assets/yorkie-plain-z9UblpzR.js","/assets/yorkie-slides-store-ELnS8I7l.js","/assets/zoom-controller-Dwo3vNr1.js"]};

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
