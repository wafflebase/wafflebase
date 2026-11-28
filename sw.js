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
const MANIFEST = {"version":"fdf2847f96ad15b0","base":"/","precache":["/assets/PrivateRoute-RED41RD1.js","/assets/index-Bu065x5X.css","/assets/index-DSzGHf3Q.js","/assets/use-chat-stream-it8SkC4r.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BRW7BEVD.js","/assets/vendor-yorkie-BduGgT4F.js"],"assets":["/assets/AuthorAvatar-ZIy-3buE.js","/assets/CommentSidePanel-MRwbKoYc.js","/assets/CommentThreadCard-DyklnPy8.js","/assets/IconArrowDown-BaPBx4KZ.js","/assets/IconArrowUp-Jjh3vrza.js","/assets/IconBorderAll-CTOy-VU1.js","/assets/IconBrush-DqEeyRnN.js","/assets/IconChevronDown-BYdnJ8rc.js","/assets/IconChevronRight-ISGoJZQi.js","/assets/IconChevronUp-wbWexBT5.js","/assets/IconCopy-BoSrT9KH.js","/assets/IconCut-DODBEJSB.js","/assets/IconDownload-DT0Zqw3B.js","/assets/IconEye-BYfrrtsE.js","/assets/IconEyeOff-408Onnga.js","/assets/IconFileTypePdf-LWl1l4My.js","/assets/IconHash-BNL58xuu.js","/assets/IconLink-CMoJyhNh.js","/assets/IconList-BTr3FPI_.js","/assets/IconListCheck-D4dzHFqs.js","/assets/IconLock-BezZ8X6g.js","/assets/IconMessagePlus-CHKF70Tt.js","/assets/IconPencil-BVVVz90j.js","/assets/IconPlayerPlay-CAyST7DE.js","/assets/IconPlus-CxkkHkXF.js","/assets/IconRowInsertTop-ujf9tLxx.js","/assets/IconTable-9soL4mO5.js","/assets/IconTrash-D83OAZ6V.js","/assets/IconUser-Dp5Q2NGV.js","/assets/IconX-CV3Q2sn1.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-CC_mUXE2.js","/assets/PrivateRoute-RED41RD1.js","/assets/abnfDiagram-VCTEODGH-CDF1Iubk.js","/assets/alert-dialog-DK3JpAKS.js","/assets/analytics-Dgk_vsIa.js","/assets/apply-imported-content-DsgZp40J.js","/assets/arc-BtOVDtvU.js","/assets/architectureDiagram-5GKGNRK7-DVByH2bq.js","/assets/avatar-COhgcRHK.js","/assets/avatar-stack-CK7CrjpD.js","/assets/badge-Br5vh-DT.js","/assets/band-BYplhCt4.js","/assets/band-numerics-iUMWzMGo.js","/assets/bar-chart-renderer-DpapbB_8.js","/assets/blockDiagram-I7D4REHJ-Bg3yihNN.js","/assets/board-detail-kwtdA8q8.js","/assets/board-document-CU600lbA.js","/assets/board-export-Dif39KV3.js","/assets/board-follow-bridge-C9LceMVf.js","/assets/board-view-Cg4fpUv_.js","/assets/c4Diagram-7LVT6UL2-Dp8l6cdh.js","/assets/channel-DqUgCH0_.js","/assets/chart-C3c5ewI-.js","/assets/chart-editor-panel-9MbWoV-_.js","/assets/chart-object-layer-CxyZEFpQ.js","/assets/chat-anchor-DvPYnMNY.js","/assets/chat-page-CyC61Ubi.js","/assets/chat-panel-B07QJ12o.js","/assets/chat-panel-context-DxKtO-dR.js","/assets/chat-panel-slot-DjtWksOB.js","/assets/checkbox-CLcgjCrH.js","/assets/chunk-2Q5K7J3B-D0C5tOAM.js","/assets/chunk-5VM5RSS4-D3dmnsck.js","/assets/chunk-F27PBJKO-Bah-sOmC.js","/assets/chunk-IMKFNOWR-HtqvKUn3.js","/assets/chunk-JWPE2WC7-BqOYxqot.js","/assets/chunk-POPQ4Y6H-DR5oYLWn.js","/assets/chunk-SVP7TREG-LLg64ejB.js","/assets/chunk-TICWLB2K-CiuZef_Z.js","/assets/chunk-XXDRQBXY-D-_9_G0z.js","/assets/classDiagram-ZZMXUADV-CFc8DiQ9.js","/assets/classDiagram-v2-VYDZK3BY-Irq4zYyo.js","/assets/code-language-packs-DQY8aEzG.js","/assets/color-swatch-button-kuZgczQz.js","/assets/conditional-format-panel-CyzTITcU.js","/assets/cose-bilkent-JH36ORCC-CLF4svwb.js","/assets/createReactComponent-DXDb_aAw.js","/assets/cynefin-OW5HDTMX-Dsd5aasC.js","/assets/cynefinDiagram-5FMLGOSQ-DMTucIFN.js","/assets/cytoscape.esm-Dya38NKz.js","/assets/dagre-GXQ25YYZ-Dmg3GvrZ.js","/assets/data-validation-panel-Cidy3Ylq.js","/assets/datasource-dialog-C0Nsv2UU.js","/assets/datasource-selector-ChovbTvj.js","/assets/datasource-view-Cjvk_uJb.js","/assets/datasources-DoJTtkF3.js","/assets/date-cell-D1CuDGgY.js","/assets/date-format-preference-Bd8qHv-f.js","/assets/default-light-DXbpiyRt.js","/assets/defaultLocale-XUIU92sl.js","/assets/diagram-S7CK7UJ4-DPc_06rF.js","/assets/diagram-UQ7AKVKN-Bt00dbX6.js","/assets/diagram-VSXAHHWV-CKMbv_mZ.js","/assets/diagram-VX7I27RA-B-fWDz_P.js","/assets/diagram-Z3DM3KII-f5zZMVnH.js","/assets/docs-detail-Dc9bkg_K.js","/assets/docs-formatting-toolbar-DhMl4Sgg.js","/assets/document-analytics-DF80C_cp.js","/assets/document-detail-B0RljsT5.js","/assets/document-link-BfnfA39_.js","/assets/document-list-Biwz8sTm.js","/assets/document-list-utils-ClENUy8o.js","/assets/document-type-meta-BDwoDyVD.js","/assets/documents-DyLjcWDD.js","/assets/docx-actions-Bd0b0TNN.js","/assets/download-file-BPmbANT2.js","/assets/draft-store-CCGB_nRw.js","/assets/dropdown-menu-CV1QbDee.js","/assets/ebnfDiagram-PWID7BFC-BIRdt4G_.js","/assets/en_US-B8ShJejW.js","/assets/en_US-BoR4fQXJ.js","/assets/erDiagram-RLTQ6QDP-B53BFHVC.js","/assets/export-utils-CucQV67-.js","/assets/file-detail-BFaedaJu.js","/assets/file-meta-5uXZpskc.js","/assets/fit-to-content-CA_rcbm9.js","/assets/flowDiagram-HODETNUW-WqynASp-.js","/assets/folders-oLfSuUcO.js","/assets/font-catalog.full-DmzxXOg7.js","/assets/font-files.data-Cwq_jaWh.js","/assets/font-size-picker-CctZQgHF.js","/assets/footer-CD6i7FRk.js","/assets/ganttDiagram-EL5Y4UJY-B-N5vwRE.js","/assets/generic-file-view-D3md6d7s.js","/assets/gitGraphDiagram-WWUBYQGX-D1VfeSts.js","/assets/group-channels-vcYSTWoG.js","/assets/history-panel-9BfehB5r.js","/assets/image-cache-BvBph9D2.js","/assets/image-object-layer-DsU41xvX.js","/assets/image-upload-BiVRGiY7.js","/assets/index-Bu065x5X.css","/assets/index-CQOselbX.js","/assets/index-DRYB305W.js","/assets/index-DSzGHf3Q.js","/assets/index-Dg8soV5l.js","/assets/index-DxB7Pyoy.js","/assets/infoDiagram-27XIBGKW-C3CCZOdW.js","/assets/init-CgS7pkjy.js","/assets/input-Qa668251.js","/assets/invite-accept-REO48odw.js","/assets/ishikawaDiagram-5VMMS53U-BHlTjHfO.js","/assets/journeyDiagram-3NMN7TZE-DBXhHqFE.js","/assets/kanban-definition-UXKFOSKX-DXP-kHX-.js","/assets/katex-CxeX4sDO.js","/assets/label-8PJq9ha4.js","/assets/lakehouse-feature-CcCLOG2j.js","/assets/layout-DADbkcQs.js","/assets/layout-SLV1opc2.js","/assets/linear-Dtpdpkpj.js","/assets/load-error-state-BpBoynb4.js","/assets/marketing-page-DHF29kDO.js","/assets/master-Dt21MuVs.js","/assets/memory-CV7_fL-B.js","/assets/mentions-CIdGRwS-.js","/assets/mermaid.core-sbmfjBDT.js","/assets/migrate-CKT0eDYC.js","/assets/mindmap-definition-YA3MSWOX-CTjSzJwB.js","/assets/mobile-slides-view-D1HLjm3J.js","/assets/notes-detail-DBc4NzaU.js","/assets/notes-editor-engine-DN9g8Oxm.js","/assets/notes-toolbar-D3RJOcsh.js","/assets/notes-view-B6GAIec9.js","/assets/ordinal-DoZP7PxM.js","/assets/page-09nEtoGJ.js","/assets/page-BM1dzwHC.js","/assets/page-CfvTvdYT.js","/assets/page-D2ajsAuy.js","/assets/page-DZmsJ7ku.js","/assets/page-Dlykdpyp.js","/assets/pdf-Cr5wQOLg.js","/assets/pdf-CsMT9EZS.js","/assets/pdf-actions-OuPQ0abW.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-CFwRBn18.js","/assets/pieDiagram-E7YTZNPT-CQ4ctjPU.js","/assets/pivot-editor-panel-BSb2msqi.js","/assets/platform-eZ4hdlEe.js","/assets/popover-BbxEzi8m.js","/assets/pptx-actions-Cs2JouRW.js","/assets/preview-surface-DQnIau13.js","/assets/public-templates-DwbVP9jn.js","/assets/purify.es-CRKEofWJ.js","/assets/quadrantDiagram-AXDQQJYC-BkzzXfGh.js","/assets/radio-group-DQtbYeye.js","/assets/railroadDiagram-O6MQD6OU-1netc4OC.js","/assets/requirementDiagram-BXWQKSXE-B9v0siD7.js","/assets/revision-preview-ikE6BpIi.js","/assets/ruler-backdrop-2yLWGoPI.js","/assets/sankeyDiagram-P5KCCOFB-BwX33hT8.js","/assets/scroll-behavior-B9xx5nOm.js","/assets/section-9lRr92j3.js","/assets/section-head-BYmjvHgW.js","/assets/select-DmoUkbi1.js","/assets/send-to-chat-BI7KPH9j.js","/assets/send-to-chat-items-DswTSRRV.js","/assets/separator-Dl4lgUKX.js","/assets/sequenceDiagram-WJ2MYXX4-DnHVdQwa.js","/assets/shape-BJechCTP.js","/assets/share-links-hFp6jt1m.js","/assets/shared-document-DvVdcDDf.js","/assets/sheet-core-Cw_iq4fu.js","/assets/sheet-formula-eval-DKefUfjB.js","/assets/sheet-formula-parser-D3eq9LOD.js","/assets/sheet-import-actions-Bp_XoskJ.js","/assets/sheet-view-Dho4nQg5.js","/assets/shortcuts-help-dialog-BufbOFlf.js","/assets/side-panel-layout-go5JbZTa.js","/assets/site-header-BfzAYlmk.js","/assets/sizeCapture-INFHLROL-BGXPDsWD.js","/assets/skeleton-D49QZfTk.js","/assets/slider-DVH0fyJc.js","/assets/slides-detail-5nw-ULXg.js","/assets/slides-editor-engine-BtpNt5XC.js","/assets/slides-image-input-DTp-aQsY.js","/assets/slides-view-B0of19Au.js","/assets/stateDiagram-D77RDMKH-B5WfEAHT.js","/assets/stateDiagram-v2-MP3YSRHH-vNgiFkFS.js","/assets/string-CxpaVyci.js","/assets/swimlanes-42K2YHIH-BFr5PONX.js","/assets/swimlanesDiagram-VR7AAH4N-Ck9ig2Bz.js","/assets/switch-BKnp7g_S.js","/assets/table-DxP0lf8q.js","/assets/table-grid-picker-DdjCyYDo.js","/assets/tabs-ZbxNkUx5.js","/assets/template-category-items-Bh_3VjaF.js","/assets/template-gallery-B39EoTTu.js","/assets/template-landing-Drs8JejQ.js","/assets/template-review-queue-Zm1s-i_7.js","/assets/templates-NLNtlD-8.js","/assets/text-edit-section-BYN14NJb.js","/assets/textarea-DJIvK75I.js","/assets/theme-panel-D0eggzOe.js","/assets/theme-toggle-CDkmZOFC.js","/assets/time-CW99jNmJ.js","/assets/timeline-definition-24CTP7MA-CnwIa9dH.js","/assets/toggle-C2m1e2jm.js","/assets/toolbar-DBr4A5NZ.js","/assets/trash-page-B3PSW4Wr.js","/assets/upload-queue-CQOHGtpn.js","/assets/use-chat-Dw4gzzZp.js","/assets/use-chat-stream-it8SkC4r.js","/assets/use-coarse-pointer-B07936HB.js","/assets/use-mobile-sheet-gestures-4kNZIqV2.js","/assets/use-object-layer-C22Biygk.js","/assets/use-presence-updater-CJ5UxwHG.js","/assets/use-revision-history-DQaRg6gd.js","/assets/use-right-panels-UU6SF3vP.js","/assets/use-send-to-chat-C0-Nvkhk.js","/assets/use-workspace-members-gGiCQmT-.js","/assets/use-workspace-nav-items-iANPpk56.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BRW7BEVD.js","/assets/vendor-ui-history-J9WR1FPV.js","/assets/vendor-yorkie-BduGgT4F.js","/assets/vennDiagram-4TSXK5OY-BGE7qypR.js","/assets/views-trend-chart-B1vkrYCn.js","/assets/waffle-logo-Jy785FIG.js","/assets/wardleyDiagram-VM6X3IG4-DrpzS0So.js","/assets/wb-button-BatzV26E.js","/assets/webhook-detail-page-zv9uCA5j.js","/assets/webhooks-section-LR4yzTWT.js","/assets/workspace-analytics-RbYeUeeD.js","/assets/workspace-documents-DJJj6kve.js","/assets/workspace-settings-Due4fYND.js","/assets/workspace-templates-SPZhOmjx.js","/assets/xychartDiagram-S5SC5T6Z--1Ejdzju.js","/assets/yield-CrAxwYPA.js","/assets/yorkie-array-remove-CNxw45vm.js","/assets/yorkie-board-store-BAWooHcq.js","/assets/yorkie-doc-store-CG8e4zNP.js","/assets/yorkie-plain-DQ-f3T6J.js","/assets/yorkie-slides-store-B2pA_Y35.js","/assets/zoom-controller-BAUfKdvW.js"]};

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
