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
const MANIFEST = {"version":"d7f7552e8c7cf483","base":"/","precache":["/assets/PrivateRoute-B60lESM_.js","/assets/index-6THGt2DT.css","/assets/index-BKpNLxTM.js","/assets/use-chat-stream-FhpDmz24.js","/assets/vendor-app-CLXZs7x8.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-Cukp7xtD.js","/assets/vendor-yorkie-XlpMlXGa.js"],"assets":["/assets/AuthorAvatar-B4FFt7YB.js","/assets/CommentSidePanel-jfnEpHST.js","/assets/CommentThreadCard-BCq1CaLt.js","/assets/IconArrowDown-BkTyQ2b6.js","/assets/IconArrowUp-QLoj2Rdu.js","/assets/IconBorderAll-CYWmTFCZ.js","/assets/IconBrush-8TVhtsG2.js","/assets/IconChevronDown-CbA6geY-.js","/assets/IconChevronRight-CuT5SZnr.js","/assets/IconChevronUp-D5CdzIDB.js","/assets/IconCopy-CMjyXASG.js","/assets/IconCut-Cv05QukA.js","/assets/IconDownload-ChOueX1M.js","/assets/IconEye-COwoFrgG.js","/assets/IconEyeOff-D-SrK2i6.js","/assets/IconFileTypePdf-CkE9ICSK.js","/assets/IconHash-BlwJXPax.js","/assets/IconLink-DN8edbRX.js","/assets/IconList-x9i0FiZ-.js","/assets/IconListCheck-CkO9sgY7.js","/assets/IconLock-aoiM8NRY.js","/assets/IconMessagePlus-CE30gSmV.js","/assets/IconPencil-NNYMuWgx.js","/assets/IconPlayerPlay-c_n-hC34.js","/assets/IconPlus-CfTDAwbU.js","/assets/IconRowInsertTop-C-2_kYdp.js","/assets/IconTable-BVMwKJ8V.js","/assets/IconTrash-BWA7fBG3.js","/assets/IconUser-CIZ4NbyN.js","/assets/IconX-Dbn045xC.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-C6ErA8xL.js","/assets/PrivateRoute-B60lESM_.js","/assets/abnfDiagram-VCTEODGH-C1Z72K4l.js","/assets/alert-dialog-dlLcVlzg.js","/assets/analytics-HO-xnmcy.js","/assets/apply-imported-content-vp5pDc_y.js","/assets/arc-CaEB0-9P.js","/assets/architectureDiagram-5GKGNRK7-B0lvH203.js","/assets/avatar-CnSsJy6o.js","/assets/avatar-stack-E3Q7z0t9.js","/assets/badge-BEI4BNL5.js","/assets/band-DH3rLjFT.js","/assets/band-numerics-Bi6l5ux4.js","/assets/bar-chart-renderer-CdSM-R4x.js","/assets/blockDiagram-I7D4REHJ-BvkxRuAk.js","/assets/board-detail-CZiyUU_O.js","/assets/board-document-CEA2ZoQj.js","/assets/board-export-C16H7aCH.js","/assets/board-follow-bridge-B3p-1jvX.js","/assets/board-view-M5RNYSn4.js","/assets/c4Diagram-7LVT6UL2-BKOaceOs.js","/assets/channel-DYbAcj6v.js","/assets/chart-editor-panel-C-ZZ8Fwq.js","/assets/chart-object-layer-CJm5HhiJ.js","/assets/chart-rL7XmT0u.js","/assets/chat-anchor-C04-dOE7.js","/assets/chat-page-C3mZdupm.js","/assets/chat-panel-DCNnq3kW.js","/assets/chat-panel-context-DkpRL1jy.js","/assets/chat-panel-slot-DXT2dR2N.js","/assets/checkbox-BxlsQiyO.js","/assets/chunk-2Q5K7J3B-NexXgwix.js","/assets/chunk-5VM5RSS4-CHvSLlBO.js","/assets/chunk-F27PBJKO-ByesmV7V.js","/assets/chunk-IMKFNOWR-DXC9zAyD.js","/assets/chunk-JWPE2WC7-DWgxpvqD.js","/assets/chunk-POPQ4Y6H-CytN0rA3.js","/assets/chunk-SVP7TREG-Ck_ftjO-.js","/assets/chunk-TICWLB2K-D8uBsbls.js","/assets/chunk-XXDRQBXY-b4XtT6hj.js","/assets/classDiagram-ZZMXUADV-BXoP0l1s.js","/assets/classDiagram-v2-VYDZK3BY-C_ZCLho7.js","/assets/code-language-packs-D1nIatAd.js","/assets/color-swatch-button-493PGGSV.js","/assets/conditional-format-panel-CTROe9sM.js","/assets/cose-bilkent-JH36ORCC-COrhsOBC.js","/assets/createReactComponent-BpR-Ztjg.js","/assets/cynefin-OW5HDTMX-CPDhU2gy.js","/assets/cynefinDiagram-5FMLGOSQ-BysgYsGe.js","/assets/cytoscape.esm-BuSyQRDc.js","/assets/dagre-GXQ25YYZ-ChUvXgUF.js","/assets/data-validation-panel-wnH_9rca.js","/assets/datasource-dialog-Cq0zFFd-.js","/assets/datasource-selector-CeQrMKs3.js","/assets/datasource-view-B7tZ5dUd.js","/assets/datasources-CY1kqDP8.js","/assets/date-cell-Cj7n6xpv.js","/assets/date-format-preference-D0OiM91Q.js","/assets/default-light-DdomOcf7.js","/assets/defaultLocale-BkPkvnNA.js","/assets/diagram-S7CK7UJ4-DLb31mLh.js","/assets/diagram-UQ7AKVKN-DuR2s4oA.js","/assets/diagram-VSXAHHWV-qu6QcS7I.js","/assets/diagram-VX7I27RA-Cg8Avmm1.js","/assets/diagram-Z3DM3KII-BNP_ScYH.js","/assets/docs-detail-BVYEzU-f.js","/assets/docs-formatting-toolbar-BzbdnDRH.js","/assets/document-analytics-C9sl38MA.js","/assets/document-detail-CTO6qGhC.js","/assets/document-link-CBjrZgVN.js","/assets/document-list-Bki50vx4.js","/assets/document-list-utils-Cgdhrq3q.js","/assets/document-type-meta-BNzQxyZl.js","/assets/documents-DCs1sq35.js","/assets/docx-actions-D5uS3NmI.js","/assets/download-file-Bn4JizdS.js","/assets/draft-store-BHZnEtbp.js","/assets/dropdown-menu-Br8MdeFA.js","/assets/ebnfDiagram-PWID7BFC-CpG1Jcd1.js","/assets/en_US-BatmKtou.js","/assets/en_US-DYmS30k3.js","/assets/erDiagram-RLTQ6QDP-DpkRmKeu.js","/assets/export-utils-Wtla6yYm.js","/assets/file-detail-c9vHkEMO.js","/assets/file-meta-mgX6kNAT.js","/assets/fit-to-content-EFx11VRE.js","/assets/flowDiagram-HODETNUW-DvzVKMNR.js","/assets/folders-XCTA_obr.js","/assets/font-catalog.full-BrkBeDiT.js","/assets/font-files.data-D9ST9XM4.js","/assets/font-size-picker-M7Erqkfg.js","/assets/footer-h525wHXw.js","/assets/ganttDiagram-EL5Y4UJY-BhMwOZh7.js","/assets/generic-file-view-FYEbh0up.js","/assets/gitGraphDiagram-WWUBYQGX-BU7od-lL.js","/assets/group-channels-CwcSZ2Vz.js","/assets/history-panel-CoDeEa9D.js","/assets/image-cache-PCTQjMAt.js","/assets/image-object-layer-CPSsAWWq.js","/assets/image-upload-fsZFIq6_.js","/assets/index-6THGt2DT.css","/assets/index-B56N4Nsq.js","/assets/index-BKpNLxTM.js","/assets/index-DgSQ8BLO.js","/assets/index-aK7BA4aU.js","/assets/index-s0Z1_T_i.js","/assets/infoDiagram-27XIBGKW--DitKZT2.js","/assets/init-Cq0Jqycp.js","/assets/input-D8-TAyAr.js","/assets/invite-accept-CEgSmh2J.js","/assets/ishikawaDiagram-5VMMS53U-CPhSayKd.js","/assets/journeyDiagram-3NMN7TZE-D24MXzc0.js","/assets/kanban-definition-UXKFOSKX-uwXv8S3Y.js","/assets/katex-DGG84gel.js","/assets/label-DJtw0G4_.js","/assets/lakehouse-feature-BdfyAp26.js","/assets/layout-DSku36QD.js","/assets/layout-pKdSCwow.js","/assets/linear-DKTQxoxU.js","/assets/load-error-state-Bh4_-jjU.js","/assets/marketing-page-CmMxLdDk.js","/assets/master-Dz2_o1l_.js","/assets/memory-DthS2VRN.js","/assets/mentions-DRcVCy3y.js","/assets/mermaid.core-D2Q2Cext.js","/assets/migrate-DSx1B84y.js","/assets/mindmap-definition-YA3MSWOX-Dm1LbctM.js","/assets/mobile-slides-view-Dq7AFu0_.js","/assets/notes-detail-BIGy4tTM.js","/assets/notes-editor-engine-CDss9ulv.js","/assets/notes-toolbar-D66-cwjP.js","/assets/notes-view-Ci4VIFs2.js","/assets/ordinal-CvT1eVz9.js","/assets/page-CaJdY_S2.js","/assets/page-Cfx_sdWR.js","/assets/page-D6eEalcO.js","/assets/page-DPQUtVgE.js","/assets/page-DSaPiDb9.js","/assets/page-GikPnTe8.js","/assets/pdf-CPiDsNCv.js","/assets/pdf-DfxA485i.js","/assets/pdf-actions-CG_SfFz5.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-C-xUz3_F.js","/assets/pieDiagram-E7YTZNPT-DQXkVQgI.js","/assets/pivot-editor-panel-Cp8AvKxv.js","/assets/platform-BAfUWgVT.js","/assets/popover-9NTqp_8l.js","/assets/pptx-actions-wSpn1Aek.js","/assets/preview-surface-DpPliXx0.js","/assets/public-templates-RR8HSBVY.js","/assets/purify.es-im-3ebKh.js","/assets/quadrantDiagram-AXDQQJYC-iaJ1eGI8.js","/assets/radio-group-B3T7A7Ov.js","/assets/railroadDiagram-O6MQD6OU-Dp95zsof.js","/assets/requirementDiagram-BXWQKSXE-DvNXygzQ.js","/assets/revision-preview-CX_10te9.js","/assets/ruler-backdrop-CHFUaJiv.js","/assets/sankeyDiagram-P5KCCOFB--YugPILo.js","/assets/scroll-behavior-CLdxgR4r.js","/assets/section-5iCgxs-W.js","/assets/section-head-D8hzyLSU.js","/assets/select-BbN41_Dw.js","/assets/send-to-chat-Ct5wtjL6.js","/assets/send-to-chat-items-DIFtrAEg.js","/assets/separator-CK3cIlRA.js","/assets/sequenceDiagram-WJ2MYXX4-DguOvdJS.js","/assets/shape-DfloQ5AT.js","/assets/share-links-CBXerTg0.js","/assets/shared-document-D3nqlOzA.js","/assets/sheet-core-BP80kiy7.js","/assets/sheet-formula-eval-Ct3q80ax.js","/assets/sheet-formula-parser-C4L-X4xC.js","/assets/sheet-import-actions-DxwQkuqa.js","/assets/sheet-view-Ulzr6zkH.js","/assets/shortcuts-help-dialog-DJENTpvc.js","/assets/side-panel-layout-D2g_oNZP.js","/assets/site-header-PZjBAwDR.js","/assets/sizeCapture-INFHLROL-RgT6m5oG.js","/assets/skeleton-uJYLKxEW.js","/assets/slider-CwqrjUYy.js","/assets/slides-detail-BrFlxy2h.js","/assets/slides-editor-engine-ayvz1Vjq.js","/assets/slides-image-input-Djqui2KP.js","/assets/slides-view-CdhAPHrg.js","/assets/stateDiagram-D77RDMKH-D4FpYuFh.js","/assets/stateDiagram-v2-MP3YSRHH-CiNFSl3R.js","/assets/string-CLQG8Dq2.js","/assets/swimlanes-42K2YHIH-nT1eHHHU.js","/assets/swimlanesDiagram-VR7AAH4N-C6kzPJ6X.js","/assets/switch-CPEQhhiQ.js","/assets/table-grid-picker-BcM-rG3D.js","/assets/table-wDqF8QzG.js","/assets/tabs-0PHmUbaS.js","/assets/template-gallery-DaHRBFQd.js","/assets/template-landing-CVBH-bDF.js","/assets/template-review-queue-BnbfSjzh.js","/assets/templates-B65uudpz.js","/assets/text-edit-section-DdW0ZU90.js","/assets/textarea-CgeE8g-z.js","/assets/theme-panel-BKp9mTum.js","/assets/theme-toggle-Cd2PUFry.js","/assets/time-CV1LcsMx.js","/assets/timeline-definition-24CTP7MA-je3Aqx6c.js","/assets/toggle-BLHsXhtV.js","/assets/toolbar-TAs2yJar.js","/assets/trash-page-GBpiOFR4.js","/assets/upload-queue-Bjz6zRwz.js","/assets/use-chat-ANyBByaW.js","/assets/use-chat-stream-FhpDmz24.js","/assets/use-coarse-pointer-DR6Qrnwh.js","/assets/use-mobile-sheet-gestures-DrxvBUFL.js","/assets/use-object-layer-BdZgJRnB.js","/assets/use-presence-updater-BWxoA2PM.js","/assets/use-revision-history-BnUqaUg8.js","/assets/use-right-panels-DMYWflHq.js","/assets/use-send-to-chat-Druo5boY.js","/assets/use-workspace-members-BOaa8mSU.js","/assets/use-workspace-nav-items-Caoby1jJ.js","/assets/vendor-app-CLXZs7x8.js","/assets/vendor-react-oNMv0XlA.js","/assets/vendor-ui-Cukp7xtD.js","/assets/vendor-ui-history-CMT0rhRg.js","/assets/vendor-yorkie-XlpMlXGa.js","/assets/vennDiagram-4TSXK5OY-B66auRQb.js","/assets/views-trend-chart-evfta9j8.js","/assets/waffle-logo-BhSrXS01.js","/assets/wardleyDiagram-VM6X3IG4-UNa3uN8h.js","/assets/wb-button-BuFhaa2D.js","/assets/webhook-detail-page-BAOvqXdb.js","/assets/webhooks-section-xYo93xZa.js","/assets/workspace-analytics-Cha0Wpn5.js","/assets/workspace-documents-p3WAD_Ea.js","/assets/workspace-settings-L_QUzsn7.js","/assets/workspace-templates-Bc1DCwSP.js","/assets/xychartDiagram-S5SC5T6Z-BGTGM-YZ.js","/assets/yield-B1UHNfma.js","/assets/yorkie-array-remove-DzhBJcTp.js","/assets/yorkie-board-store-Dn7ZSkKo.js","/assets/yorkie-doc-store-BEsA1Viq.js","/assets/yorkie-plain-z9UblpzR.js","/assets/yorkie-slides-store-CVcUUwiN.js","/assets/zoom-controller-Dwo3vNr1.js"]};

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
