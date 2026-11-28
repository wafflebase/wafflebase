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
const MANIFEST = {"version":"435438a21d2b4e31","base":"/","precache":["/assets/PrivateRoute-7RG0-_S2.js","/assets/index-BJY_oz8i.js","/assets/index-Bu065x5X.css","/assets/use-chat-stream-BoHVsHug.js","/assets/vendor-app-BvZTr-pA.js","/assets/vendor-react-C7W141vO.js","/assets/vendor-ui-BtXXoJXx.js","/assets/vendor-yorkie-BklHLZha.js"],"assets":["/assets/AuthorAvatar-D1KwQ6Ix.js","/assets/CommentSidePanel-C7uXVCMY.js","/assets/CommentThreadCard-ClCkpTpt.js","/assets/IconArrowDown-BCZYwrNh.js","/assets/IconArrowUp-BlChRt7j.js","/assets/IconBorderAll-BC8BNy4C.js","/assets/IconBrush-DZABlEtD.js","/assets/IconChevronDown-CjVsZfq-.js","/assets/IconChevronRight-Cc4MEycj.js","/assets/IconChevronUp-ChlSIr6T.js","/assets/IconCopy-CirOTqQC.js","/assets/IconCut-BWZvpCs-.js","/assets/IconDownload-CyCP8r_O.js","/assets/IconEye-CalrSgMO.js","/assets/IconEyeOff-DXOW81OY.js","/assets/IconFileTypePdf-Cs98cB3x.js","/assets/IconHash-CiIBofnS.js","/assets/IconLink-DMzCBJOG.js","/assets/IconList-OqIcNR2e.js","/assets/IconListCheck-D0tMnqex.js","/assets/IconLock-mZDKHqXG.js","/assets/IconMessagePlus-CUV01rUu.js","/assets/IconPencil-BPgTSI1N.js","/assets/IconPlayerPlay-CCN8ETgj.js","/assets/IconPlus-CSil1F1I.js","/assets/IconRowInsertTop-55OLl4Nl.js","/assets/IconTable-BQSBkApS.js","/assets/IconTrash-Cbp6jl3H.js","/assets/IconUser-DWEkzRrn.js","/assets/IconX-Bnc9A5fY.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-CYmSmg8y.js","/assets/PrivateRoute-7RG0-_S2.js","/assets/abnfDiagram-VCTEODGH-CXFW25ZP.js","/assets/alert-dialog-UXHH0h3f.js","/assets/analytics-CaToedme.js","/assets/apply-imported-content-D9D74lOW.js","/assets/arc-BHX1xbQa.js","/assets/architectureDiagram-5GKGNRK7-B6D3a78R.js","/assets/avatar-DwIbqxHb.js","/assets/avatar-stack-LgIOyQAV.js","/assets/badge-Py2hCJeK.js","/assets/band-iDxhg-_6.js","/assets/band-numerics-UgqFgJzD.js","/assets/bar-chart-renderer-BZu1ERR-.js","/assets/blockDiagram-I7D4REHJ-CMTnw2oN.js","/assets/board-detail-DVgtStXI.js","/assets/board-document-CUcPpfjR.js","/assets/board-export-CcrU2klH.js","/assets/board-follow-bridge-Cgit1ypP.js","/assets/board-view-C179iYxu.js","/assets/c4Diagram-7LVT6UL2-GkRkpp7C.js","/assets/channel-CcmPxdAj.js","/assets/chart-BCZgUeRz.js","/assets/chart-editor-panel-DDWSMDT-.js","/assets/chart-object-layer-DQEKfo6B.js","/assets/chat-anchor-CRnmf8yf.js","/assets/chat-page-D5lpbdjf.js","/assets/chat-panel-B3BxPAIk.js","/assets/chat-panel-context-rKlbPynx.js","/assets/chat-panel-slot-Dj6c37cF.js","/assets/checkbox-CsEVuape.js","/assets/chunk-2Q5K7J3B-B-COVpV4.js","/assets/chunk-5VM5RSS4-y_z-z9Q-.js","/assets/chunk-F27PBJKO-eQFesvnZ.js","/assets/chunk-IMKFNOWR-BfSxVh3u.js","/assets/chunk-JWPE2WC7-B_PuzKWe.js","/assets/chunk-POPQ4Y6H-BjjX2U0S.js","/assets/chunk-SVP7TREG-B_UY_CYG.js","/assets/chunk-TICWLB2K-DGxUo1Dp.js","/assets/chunk-XXDRQBXY-CwBypA9d.js","/assets/classDiagram-ZZMXUADV-DXd3J5ei.js","/assets/classDiagram-v2-VYDZK3BY-gjJXbZOn.js","/assets/code-language-packs-Bt91YolK.js","/assets/color-swatch-button-BJzJtJeq.js","/assets/conditional-format-panel-C1R0sT0M.js","/assets/cose-bilkent-JH36ORCC-uhD3W19a.js","/assets/createReactComponent-Cn4En0Xm.js","/assets/cynefin-OW5HDTMX-CNBf_0cv.js","/assets/cynefinDiagram-5FMLGOSQ-DjOxwiQc.js","/assets/cytoscape.esm-C67lDsI5.js","/assets/dagre-GXQ25YYZ-DITZ5noq.js","/assets/data-validation-panel-Do-rHfzg.js","/assets/datasource-dialog-HhKsNMWv.js","/assets/datasource-selector-DsxxqezI.js","/assets/datasource-view-BQh_4o-Q.js","/assets/datasources-ry0CUy5l.js","/assets/date-cell-Cxc9Fbag.js","/assets/date-format-preference-CASOE73s.js","/assets/default-light-BQR35o0Y.js","/assets/defaultLocale-Cy__Hfzm.js","/assets/diagram-S7CK7UJ4-CH8_JUpn.js","/assets/diagram-UQ7AKVKN-BIWdpAmr.js","/assets/diagram-VSXAHHWV-CH7Xdzmr.js","/assets/diagram-VX7I27RA-anmtoIgq.js","/assets/diagram-Z3DM3KII-DhP2rkMD.js","/assets/docs-detail-CjdGwHm8.js","/assets/docs-formatting-toolbar-Duq9DwWY.js","/assets/document-analytics-JsYo62dx.js","/assets/document-detail-CgPieOgi.js","/assets/document-link-go-hyBcZ.js","/assets/document-list-8R1g4pYg.js","/assets/document-list-utils-CJ87k8lk.js","/assets/document-type-meta-02id_auL.js","/assets/documents-CwZQzrOd.js","/assets/docx-actions-IA8Q3H_x.js","/assets/download-file-CgBO-HUm.js","/assets/draft-store-oSaQElSq.js","/assets/dropdown-menu-CXZAO5uG.js","/assets/ebnfDiagram-PWID7BFC-D9RPXzgZ.js","/assets/en_US-5Xs3lbpF.js","/assets/en_US-CdXMl3pN.js","/assets/erDiagram-RLTQ6QDP-D2OPrdS1.js","/assets/export-utils-DSANTRHY.js","/assets/file-detail-CU7fpAIp.js","/assets/file-meta-DInbk8LA.js","/assets/fit-to-content-yANsO-1d.js","/assets/flowDiagram-HODETNUW-BMSew4al.js","/assets/folders-DyUQpa1T.js","/assets/font-catalog.full-B8ZhFDah.js","/assets/font-files.data-CJBWso22.js","/assets/font-size-picker-CrLG7i2v.js","/assets/footer-CCmi6N0S.js","/assets/ganttDiagram-EL5Y4UJY-DSmeX6PU.js","/assets/generic-file-view-BOO7A4bO.js","/assets/gitGraphDiagram-WWUBYQGX-yXSkmGdY.js","/assets/group-channels-CFbwzlHa.js","/assets/history-panel-CaFJApkZ.js","/assets/image-cache-BiG3S41o.js","/assets/image-object-layer-BZ85jgYr.js","/assets/image-upload-CzqloYZw.js","/assets/index-BJY_oz8i.js","/assets/index-BSiUy6Qo.js","/assets/index-Bu065x5X.css","/assets/index-CL4o2vzr.js","/assets/index-COmbUKJU.js","/assets/index-Dftbwn2P.js","/assets/infoDiagram-27XIBGKW-4uKeDsQA.js","/assets/init-CRNmhS_2.js","/assets/input-CX5uXi56.js","/assets/invite-accept-B5ic6nzw.js","/assets/ishikawaDiagram-5VMMS53U-DmzFqx2m.js","/assets/journeyDiagram-3NMN7TZE-Cdn8zhGg.js","/assets/kanban-definition-UXKFOSKX-BpLsryuu.js","/assets/katex-DaD7T3kz.js","/assets/label-DRnBAHOv.js","/assets/lakehouse-feature-nIstYACk.js","/assets/layout-A0oYwh8Y.js","/assets/layout-AP93QHxK.js","/assets/linear-BoSi7ORZ.js","/assets/load-error-state-Dsqi6F_G.js","/assets/marketing-page-D0i07eW-.js","/assets/master-CXWF4xhT.js","/assets/memory-h-ODt2KZ.js","/assets/mentions-pmN5wGMm.js","/assets/mermaid.core-BiMCoI6U.js","/assets/migrate-Cwrzcc8D.js","/assets/mindmap-definition-YA3MSWOX-CeDvLhT6.js","/assets/mobile-slides-view-Ca9GuHE3.js","/assets/notes-detail-BBSOYvfK.js","/assets/notes-editor-engine-D7HiJgZL.js","/assets/notes-toolbar-DGYVrtKs.js","/assets/notes-view-CQYXViDX.js","/assets/ordinal-B_N5yIVL.js","/assets/page-C6HQEiha.js","/assets/page-CRm4yJkV.js","/assets/page-CT7MI2e3.js","/assets/page-DaDVwRM4.js","/assets/page-DjBzgNcb.js","/assets/page-DmUFQFbN.js","/assets/pdf-BJVPsNly.js","/assets/pdf-CrI5YuzP.js","/assets/pdf-actions-DuvH0PEw.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-bLc6V2_S.js","/assets/pieDiagram-E7YTZNPT-BGaRbTX9.js","/assets/pivot-editor-panel-CnkM5fjp.js","/assets/platform-BFPfQV1J.js","/assets/popover-Dm2tSose.js","/assets/pptx-actions-D-EQVgyK.js","/assets/preview-surface-DMhT9mwo.js","/assets/public-templates-Bh1Yn5hq.js","/assets/purify.es-ByJOhQsB.js","/assets/quadrantDiagram-AXDQQJYC-B2x1nnUW.js","/assets/radio-group-_F5iq_C6.js","/assets/railroadDiagram-O6MQD6OU-BDLNV1Q3.js","/assets/requirementDiagram-BXWQKSXE-BuhJd3f2.js","/assets/revision-preview-BxaUkMmE.js","/assets/ruler-backdrop-M2q2jidT.js","/assets/sankeyDiagram-P5KCCOFB-BPJEM8Ub.js","/assets/scroll-behavior-D1Htb1MI.js","/assets/section-BrV50LGn.js","/assets/section-head-CFBFQ572.js","/assets/select-BfOMGO56.js","/assets/send-to-chat-Sxl_lGcU.js","/assets/send-to-chat-items-BP-x9Q9N.js","/assets/separator-Bl8F49Ji.js","/assets/sequenceDiagram-WJ2MYXX4-Sz3LXDkh.js","/assets/shape-DayQDfEN.js","/assets/share-links-Dh3DJiCN.js","/assets/shared-document-DUJEV0EI.js","/assets/sheet-core-BiWok4y-.js","/assets/sheet-formula-eval-BA0PT_nZ.js","/assets/sheet-formula-parser-BnFlieRc.js","/assets/sheet-import-actions-PQ5LjwGe.js","/assets/sheet-view-2mHzw4rJ.js","/assets/shortcuts-help-dialog-DNxGwZ9_.js","/assets/side-panel-layout-DXS2j_q9.js","/assets/site-header-DxtOAMbh.js","/assets/sizeCapture-INFHLROL-DkU71bb5.js","/assets/skeleton-CgkR9xXV.js","/assets/slider-BkqNZ0Uy.js","/assets/slides-detail-CntMHboW.js","/assets/slides-editor-engine-BlwN1t57.js","/assets/slides-image-input-CWB716zw.js","/assets/slides-view-8YmcsJwu.js","/assets/stateDiagram-D77RDMKH-DunwJMSC.js","/assets/stateDiagram-v2-MP3YSRHH-BpFf7e3I.js","/assets/string-BLpNNkgh.js","/assets/swimlanes-42K2YHIH-FohYeOuX.js","/assets/swimlanesDiagram-VR7AAH4N-BOy5lx8p.js","/assets/switch-B1raubJR.js","/assets/table-BKxh0BiH.js","/assets/table-grid-picker-CTne1z2N.js","/assets/tabs-CKP3JIHg.js","/assets/template-category-items-BqYFrKT5.js","/assets/template-gallery-DcyPUY2y.js","/assets/template-landing-CP6TiWb8.js","/assets/template-review-queue-CsZifYVF.js","/assets/templates-ys551pN2.js","/assets/text-edit-section-C7dhaQeE.js","/assets/textarea-Cj9sRohH.js","/assets/theme-panel-DVR__Szj.js","/assets/theme-toggle-CkF-SwBF.js","/assets/time-D4RmzEW5.js","/assets/timeline-definition-24CTP7MA-DQENSnrz.js","/assets/toggle-Bx94iSa3.js","/assets/toolbar-C61VXJQd.js","/assets/trash-page-PzUF6Y87.js","/assets/upload-queue-BHuMkqmP.js","/assets/use-chat-BQhO057H.js","/assets/use-chat-stream-BoHVsHug.js","/assets/use-coarse-pointer-BeZSi7dC.js","/assets/use-mobile-sheet-gestures-DviSMF3l.js","/assets/use-object-layer-CNHzEE9h.js","/assets/use-presence-updater-FWsN1KxI.js","/assets/use-revision-history-Bm-5ap9Z.js","/assets/use-right-panels-C7Zyh2tf.js","/assets/use-send-to-chat-Ch1KvUAJ.js","/assets/use-workspace-members-DJOMAyWK.js","/assets/use-workspace-nav-items-DKfZCY49.js","/assets/vendor-app-BvZTr-pA.js","/assets/vendor-react-C7W141vO.js","/assets/vendor-ui-BtXXoJXx.js","/assets/vendor-ui-history-z1vSn71v.js","/assets/vendor-yorkie-BklHLZha.js","/assets/vennDiagram-4TSXK5OY-Bmna3a74.js","/assets/views-trend-chart-Bj0UlTAe.js","/assets/waffle-logo-Nlfl1kCG.js","/assets/wardleyDiagram-VM6X3IG4-CHIAy0EE.js","/assets/wb-button-Gjo2VwSW.js","/assets/webhook-detail-page-D_rsC2Pj.js","/assets/webhooks-section-BqMTNbsI.js","/assets/workspace-analytics-D2eRokkB.js","/assets/workspace-documents-pmHh6-8q.js","/assets/workspace-settings-nxG6_gTL.js","/assets/workspace-templates-DjyNBtXU.js","/assets/xychartDiagram-S5SC5T6Z-DR1kSsP7.js","/assets/yield-DoyPqK5A.js","/assets/yorkie-array-remove-7fnMPkfP.js","/assets/yorkie-board-store-16nhrvoF.js","/assets/yorkie-doc-store-D1x3BpHi.js","/assets/yorkie-plain-C7kaqBB2.js","/assets/yorkie-slides-store-BP5kUfM-.js","/assets/zoom-controller-BdhfbKMm.js"]};

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
