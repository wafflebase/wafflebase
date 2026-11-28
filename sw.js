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
const MANIFEST = {"version":"e87066daddc22571","base":"/","precache":["/assets/PrivateRoute-Cj7-69kA.js","/assets/index-DehUHoGt.js","/assets/index-rLUTdiCn.css","/assets/use-chat-stream-DwHPKLxT.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BqKa4cGI.js","/assets/vendor-yorkie-BduGgT4F.js"],"assets":["/assets/AuthorAvatar-mRSZKwkx.js","/assets/CommentSidePanel-_bkCRdj0.js","/assets/CommentThreadCard-DPVRVIQl.js","/assets/IconArrowDown-BaPBx4KZ.js","/assets/IconArrowUp-Jjh3vrza.js","/assets/IconBorderAll-CTOy-VU1.js","/assets/IconBrush-DqEeyRnN.js","/assets/IconChevronDown-BYdnJ8rc.js","/assets/IconChevronRight-ISGoJZQi.js","/assets/IconChevronUp-wbWexBT5.js","/assets/IconCopy-BoSrT9KH.js","/assets/IconCut-DODBEJSB.js","/assets/IconDownload-DT0Zqw3B.js","/assets/IconEye-BYfrrtsE.js","/assets/IconEyeOff-408Onnga.js","/assets/IconFileTypePdf-LWl1l4My.js","/assets/IconHash-BNL58xuu.js","/assets/IconLink-CMoJyhNh.js","/assets/IconList-BTr3FPI_.js","/assets/IconListCheck-D4dzHFqs.js","/assets/IconLock-BezZ8X6g.js","/assets/IconMessagePlus-CHKF70Tt.js","/assets/IconPencil-BVVVz90j.js","/assets/IconPlayerPlay-CAyST7DE.js","/assets/IconPlus-CxkkHkXF.js","/assets/IconRowInsertTop-ujf9tLxx.js","/assets/IconTable-9soL4mO5.js","/assets/IconTrash-D83OAZ6V.js","/assets/IconUser-Dp5Q2NGV.js","/assets/IconX-CV3Q2sn1.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-DGccGVLU.js","/assets/PrivateRoute-Cj7-69kA.js","/assets/abnfDiagram-VCTEODGH-DetsCJPH.js","/assets/alert-dialog-Z0y4ztgx.js","/assets/analytics-BMvSYd1x.js","/assets/apply-imported-content-Cj08ahj7.js","/assets/arc-BtOVDtvU.js","/assets/architectureDiagram-5GKGNRK7-DBQcQY4E.js","/assets/avatar-D-feVegl.js","/assets/avatar-stack-Dwph5MvL.js","/assets/badge-ChgYcOHv.js","/assets/band-BYplhCt4.js","/assets/band-numerics-iUMWzMGo.js","/assets/bar-chart-renderer-Dg2PZQHu.js","/assets/blockDiagram-I7D4REHJ-RxV6v1NG.js","/assets/board-detail-O0ev65ch.js","/assets/board-document-CU600lbA.js","/assets/board-export-lK9Skytp.js","/assets/board-follow-bridge-C9LceMVf.js","/assets/board-view-CVExICwM.js","/assets/c4Diagram-7LVT6UL2-B-1OF7_8.js","/assets/channel-xb07b3XE.js","/assets/chart-editor-panel-DYsRpvN6.js","/assets/chart-imtAp8dp.js","/assets/chart-object-layer-DIwogCUe.js","/assets/chat-anchor-Bd9FwZZb.js","/assets/chat-page-RN5H0cZx.js","/assets/chat-panel-CAR9Do-B.js","/assets/chat-panel-context-CVsF9vyq.js","/assets/chat-panel-slot-qqtkI1bR.js","/assets/checkbox-CeeP14VU.js","/assets/chunk-2Q5K7J3B-BwH3jVAf.js","/assets/chunk-5VM5RSS4-52oBAzNe.js","/assets/chunk-F27PBJKO-CgukD2Tr.js","/assets/chunk-IMKFNOWR-Cb4Gv5bh.js","/assets/chunk-JWPE2WC7-Bqomg2gr.js","/assets/chunk-POPQ4Y6H-DmR_Badc.js","/assets/chunk-SVP7TREG-U-YlWk7H.js","/assets/chunk-TICWLB2K-DMeIuw_B.js","/assets/chunk-XXDRQBXY-Dg1ltWI-.js","/assets/classDiagram-ZZMXUADV-B3VPvC8f.js","/assets/classDiagram-v2-VYDZK3BY-DT_CyKta.js","/assets/code-language-packs-9XBX4dO9.js","/assets/color-swatch-button-BiAmZXuq.js","/assets/conditional-format-panel-BXx30l74.js","/assets/cose-bilkent-JH36ORCC-CsdNdLC6.js","/assets/createReactComponent-DXDb_aAw.js","/assets/cynefin-OW5HDTMX-Dsd5aasC.js","/assets/cynefinDiagram-5FMLGOSQ-DgPCblOF.js","/assets/cytoscape.esm-Dya38NKz.js","/assets/dagre-GXQ25YYZ-BPx0Pr7n.js","/assets/data-validation-panel-2h2lQWxp.js","/assets/datasource-dialog-C1YShZn1.js","/assets/datasource-selector-BzPKmdul.js","/assets/datasource-view--f-BR2iC.js","/assets/datasources-CuxwL1je.js","/assets/date-cell-D1CuDGgY.js","/assets/date-format-preference-Bd8qHv-f.js","/assets/default-light-DXbpiyRt.js","/assets/defaultLocale-XUIU92sl.js","/assets/diagram-S7CK7UJ4-CT6d3ERW.js","/assets/diagram-UQ7AKVKN-CpMT6Enl.js","/assets/diagram-VSXAHHWV-BbRs6-ZJ.js","/assets/diagram-VX7I27RA-BVebimdH.js","/assets/diagram-Z3DM3KII-9InH6oll.js","/assets/docs-detail-q6MrfZZy.js","/assets/docs-formatting-toolbar-BGRQh-6o.js","/assets/document-analytics-DWQ3aGqn.js","/assets/document-detail-CaH4mqV9.js","/assets/document-link-BfnfA39_.js","/assets/document-list-CRGqNtAL.js","/assets/document-list-utils-ClENUy8o.js","/assets/document-type-meta-Bif_cML4.js","/assets/documents-3N5kbQMk.js","/assets/docx-actions-C6sSEbbK.js","/assets/download-file-Czao0ELQ.js","/assets/draft-store-CCGB_nRw.js","/assets/dropdown-menu-BhE61Vw4.js","/assets/ebnfDiagram-PWID7BFC-BTB4S9PU.js","/assets/en_US-B8ShJejW.js","/assets/en_US-BoR4fQXJ.js","/assets/erDiagram-RLTQ6QDP-HpZasVFN.js","/assets/export-utils-CPZgspbY.js","/assets/file-detail-BWxF_htL.js","/assets/file-meta-BHCHYNTj.js","/assets/fit-to-content-CA_rcbm9.js","/assets/flowDiagram-HODETNUW-BD6CAPna.js","/assets/folders-Cr5SknLE.js","/assets/font-catalog.full-DmzxXOg7.js","/assets/font-files.data-Cwq_jaWh.js","/assets/font-size-picker-DaCp-t-1.js","/assets/footer-J07aLzwK.js","/assets/ganttDiagram-EL5Y4UJY-Cy66mlCk.js","/assets/generic-file-view-DHAGXMBl.js","/assets/gitGraphDiagram-WWUBYQGX-rHGuDeCJ.js","/assets/group-channels-C6Gwcx73.js","/assets/history-panel-DcY-_-pM.js","/assets/image-cache-BvBph9D2.js","/assets/image-object-layer-DsU41xvX.js","/assets/image-upload-CiAe906w.js","/assets/index-CZsPJJbU.js","/assets/index-Cjehl2sF.js","/assets/index-DO47GH4n.js","/assets/index-DehUHoGt.js","/assets/index-Dg8soV5l.js","/assets/index-rLUTdiCn.css","/assets/infoDiagram-27XIBGKW-CoJVwo-C.js","/assets/init-CgS7pkjy.js","/assets/input-B-sOiGgw.js","/assets/invite-accept-vlnSw0za.js","/assets/ishikawaDiagram-5VMMS53U-V4kLGYhP.js","/assets/journeyDiagram-3NMN7TZE-C-N06O6u.js","/assets/kanban-definition-UXKFOSKX-BylU5H5p.js","/assets/katex-CxeX4sDO.js","/assets/label-BuxLp0UJ.js","/assets/lakehouse-feature-D0gJUCEr.js","/assets/layout-DADbkcQs.js","/assets/layout-Dv4kaC4p.js","/assets/linear-Dtpdpkpj.js","/assets/load-error-state-j5152f5U.js","/assets/marketing-page-CyQaYlBp.js","/assets/master-Dt21MuVs.js","/assets/memory-CV7_fL-B.js","/assets/mentions-CuVGKiM6.js","/assets/mermaid.core-CRd5Uu6j.js","/assets/migrate-CKT0eDYC.js","/assets/mindmap-definition-YA3MSWOX-C2TuaFgX.js","/assets/mobile-slides-view-UizXh40D.js","/assets/notes-detail-V0Dr6npO.js","/assets/notes-editor-engine-m8_i0tsL.js","/assets/notes-toolbar-BQap8R8D.js","/assets/notes-view-GbkfBAWT.js","/assets/ordinal-DoZP7PxM.js","/assets/page-BM1dzwHC.js","/assets/page-BSxMF3YV.js","/assets/page-BgS4v_VT.js","/assets/page-Bsxlla4E.js","/assets/page-C2tdf177.js","/assets/page-g9Oqle_S.js","/assets/pdf-Cr5wQOLg.js","/assets/pdf-CsMT9EZS.js","/assets/pdf-actions-DOC3Byzm.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-CeIqmSUq.js","/assets/pieDiagram-E7YTZNPT-DYcv5oJM.js","/assets/pivot-editor-panel-Bup-c7zO.js","/assets/platform-eZ4hdlEe.js","/assets/popover-CDFM0Lpq.js","/assets/pptx-actions-DTeqziPY.js","/assets/preview-surface-DOVndz0X.js","/assets/public-templates-Du8l9lgs.js","/assets/purify.es-CRKEofWJ.js","/assets/quadrantDiagram-AXDQQJYC-DkBO72n6.js","/assets/radio-group-DXeD1vaE.js","/assets/railroadDiagram-O6MQD6OU-5ZtQ23-I.js","/assets/requirementDiagram-BXWQKSXE-DOyiv4Sj.js","/assets/revision-preview-BQt3uF0X.js","/assets/ruler-backdrop-BUpL0LEX.js","/assets/sankeyDiagram-P5KCCOFB-DTC7HWjR.js","/assets/scroll-behavior-B9xx5nOm.js","/assets/section-9lRr92j3.js","/assets/section-head-CL3QZK_m.js","/assets/select-Cl8mLjpe.js","/assets/send-to-chat-BI7KPH9j.js","/assets/send-to-chat-items-DswTSRRV.js","/assets/separator-m3n9oKvX.js","/assets/sequenceDiagram-WJ2MYXX4-vFe1jsxp.js","/assets/shape-BJechCTP.js","/assets/share-links-BY7XmMQu.js","/assets/shared-document-CXLuy76s.js","/assets/sheet-core-Cw_iq4fu.js","/assets/sheet-formula-eval-DKefUfjB.js","/assets/sheet-formula-parser-D3eq9LOD.js","/assets/sheet-import-actions-BBo1SxR0.js","/assets/sheet-view-DDePSEpz.js","/assets/shortcuts-help-dialog-BKBPs_m0.js","/assets/side-panel-layout-go5JbZTa.js","/assets/site-header-B-S9oktk.js","/assets/sizeCapture-INFHLROL-BVCqnToG.js","/assets/skeleton-CeHgTFxl.js","/assets/slider-BQkEaZVw.js","/assets/slides-detail-Bg2SIO67.js","/assets/slides-editor-engine-BtpNt5XC.js","/assets/slides-image-input-4Q7kriu1.js","/assets/slides-view-CQXxog0N.js","/assets/stateDiagram-D77RDMKH-pJ-fZeCO.js","/assets/stateDiagram-v2-MP3YSRHH-BF9ovrc8.js","/assets/string-CxpaVyci.js","/assets/swimlanes-42K2YHIH-D-LxgYaQ.js","/assets/swimlanesDiagram-VR7AAH4N-Bmb8cqB5.js","/assets/switch-DjNI8DXV.js","/assets/table-CWZmYFV_.js","/assets/table-grid-picker-DdjCyYDo.js","/assets/tabs-WcOsfQPr.js","/assets/template-category-items-Da-GfxNd.js","/assets/template-gallery-Dx3BWKhE.js","/assets/template-landing-ChtMzB5o.js","/assets/template-review-queue-B2iaT1jx.js","/assets/templates-CnrtxRgu.js","/assets/text-edit-section-BUvmnccV.js","/assets/textarea-CTgV0fKu.js","/assets/theme-panel-DMDEZgWn.js","/assets/theme-toggle-JuTuI_1v.js","/assets/time-CW99jNmJ.js","/assets/timeline-definition-24CTP7MA-s9WC3VDJ.js","/assets/toggle-BlNx0sz3.js","/assets/toolbar-BC1qc1We.js","/assets/trash-page-CKZa_eHs.js","/assets/upload-queue-Djv_RKur.js","/assets/use-chat-CtD2F3lX.js","/assets/use-chat-stream-DwHPKLxT.js","/assets/use-coarse-pointer-B07936HB.js","/assets/use-mobile-sheet-gestures-FenNqO-j.js","/assets/use-object-layer-C22Biygk.js","/assets/use-presence-updater-BbNZax8g.js","/assets/use-revision-history-C5EVQitD.js","/assets/use-right-panels-UU6SF3vP.js","/assets/use-send-to-chat-CZefUgdx.js","/assets/use-workspace-members-hKhSc3uh.js","/assets/use-workspace-nav-items-DAxkz8hY.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BqKa4cGI.js","/assets/vendor-ui-history-BIf2_o7i.js","/assets/vendor-yorkie-BduGgT4F.js","/assets/vennDiagram-4TSXK5OY-DZrmqTrP.js","/assets/views-trend-chart-AVbU4flC.js","/assets/waffle-logo-Jy785FIG.js","/assets/wardleyDiagram-VM6X3IG4-CjPckhgg.js","/assets/wb-button-CJezyxft.js","/assets/webhook-detail-page-CFG7Vkan.js","/assets/webhooks-section-BV_nUjPU.js","/assets/workspace-analytics-CcHsho-v.js","/assets/workspace-documents-J0-4M975.js","/assets/workspace-settings-BWD4_xyJ.js","/assets/workspace-templates-DRTt6E_B.js","/assets/xychartDiagram-S5SC5T6Z-B3ms5ch7.js","/assets/yield-CrAxwYPA.js","/assets/yorkie-array-remove-CNxw45vm.js","/assets/yorkie-board-store-BAWooHcq.js","/assets/yorkie-doc-store-CG8e4zNP.js","/assets/yorkie-plain-DQ-f3T6J.js","/assets/yorkie-slides-store-B2pA_Y35.js","/assets/zoom-controller-BAUfKdvW.js"]};

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
