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
const MANIFEST = {"version":"0cd6719647b45abc","base":"/","precache":["/assets/PrivateRoute-Cq1Azr8w.js","/assets/index-BPEPoCQk.js","/assets/index-rLUTdiCn.css","/assets/use-chat-stream-D2krsntO.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BqKa4cGI.js","/assets/vendor-yorkie-BduGgT4F.js"],"assets":["/assets/AuthorAvatar-B3PvVtU2.js","/assets/CommentSidePanel-LQv4L53P.js","/assets/CommentThreadCard-pV5f8Ze4.js","/assets/IconArrowDown-BaPBx4KZ.js","/assets/IconArrowUp-Jjh3vrza.js","/assets/IconBorderAll-CTOy-VU1.js","/assets/IconBrush-DqEeyRnN.js","/assets/IconChevronDown-BYdnJ8rc.js","/assets/IconChevronRight-ISGoJZQi.js","/assets/IconChevronUp-wbWexBT5.js","/assets/IconCopy-BoSrT9KH.js","/assets/IconCut-DODBEJSB.js","/assets/IconDownload-DT0Zqw3B.js","/assets/IconEye-BYfrrtsE.js","/assets/IconEyeOff-408Onnga.js","/assets/IconFileTypePdf-LWl1l4My.js","/assets/IconHash-BNL58xuu.js","/assets/IconLink-CMoJyhNh.js","/assets/IconList-BTr3FPI_.js","/assets/IconListCheck-D4dzHFqs.js","/assets/IconLock-BezZ8X6g.js","/assets/IconMessagePlus-CHKF70Tt.js","/assets/IconPencil-BVVVz90j.js","/assets/IconPlayerPlay-CAyST7DE.js","/assets/IconPlus-CxkkHkXF.js","/assets/IconRowInsertTop-ujf9tLxx.js","/assets/IconTable-9soL4mO5.js","/assets/IconTrash-D83OAZ6V.js","/assets/IconUser-Dp5Q2NGV.js","/assets/IconX-CV3Q2sn1.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/Layout-eF-iRalj.js","/assets/PrivateRoute-Cq1Azr8w.js","/assets/abnfDiagram-VCTEODGH-DetsCJPH.js","/assets/alert-dialog-BCoQt1dz.js","/assets/analytics-DTh1Wsmt.js","/assets/apply-imported-content-MThogOdW.js","/assets/arc-BtOVDtvU.js","/assets/architectureDiagram-5GKGNRK7-DBQcQY4E.js","/assets/avatar-Ce5GZd1w.js","/assets/avatar-stack-BwfTzc-l.js","/assets/badge-CZCakBtJ.js","/assets/band-BYplhCt4.js","/assets/band-numerics-DQ4UjKKL.js","/assets/bar-chart-renderer-CqEd-XTc.js","/assets/blockDiagram-I7D4REHJ-RxV6v1NG.js","/assets/board-detail-BBnkcsDN.js","/assets/board-document-CU600lbA.js","/assets/board-export-CFHRHCZG.js","/assets/board-follow-bridge-C9LceMVf.js","/assets/board-view-Dn_hAOXf.js","/assets/c4Diagram-7LVT6UL2-B-1OF7_8.js","/assets/channel-xb07b3XE.js","/assets/chart-Cx2xQg83.js","/assets/chart-editor-panel-0oyBfFlC.js","/assets/chart-object-layer-NI5ut4rg.js","/assets/chat-anchor-D2QlZZFR.js","/assets/chat-page-Clhp2Fut.js","/assets/chat-panel-DQvZQq4t.js","/assets/chat-panel-context-Datgdbib.js","/assets/chat-panel-slot-Br0xO_H2.js","/assets/checkbox-p32Rs4KW.js","/assets/chunk-2Q5K7J3B-BwH3jVAf.js","/assets/chunk-5VM5RSS4-52oBAzNe.js","/assets/chunk-F27PBJKO-CgukD2Tr.js","/assets/chunk-IMKFNOWR-Cb4Gv5bh.js","/assets/chunk-JWPE2WC7-Bqomg2gr.js","/assets/chunk-POPQ4Y6H-DmR_Badc.js","/assets/chunk-SVP7TREG-U-YlWk7H.js","/assets/chunk-TICWLB2K-DMeIuw_B.js","/assets/chunk-XXDRQBXY-Dg1ltWI-.js","/assets/classDiagram-ZZMXUADV-B3VPvC8f.js","/assets/classDiagram-v2-VYDZK3BY-DT_CyKta.js","/assets/code-language-packs-9XBX4dO9.js","/assets/color-swatch-button-DhaTCRV0.js","/assets/conditional-format-panel-_ousLhNx.js","/assets/cose-bilkent-JH36ORCC-CsdNdLC6.js","/assets/createReactComponent-DXDb_aAw.js","/assets/cynefin-OW5HDTMX-Dsd5aasC.js","/assets/cynefinDiagram-5FMLGOSQ-DgPCblOF.js","/assets/cytoscape.esm-Dya38NKz.js","/assets/dagre-GXQ25YYZ-BPx0Pr7n.js","/assets/data-validation-panel-6ViSFsnC.js","/assets/datasource-dialog-DwjvNKEF.js","/assets/datasource-selector-C7SIWqXV.js","/assets/datasource-view-Ckun6KHf.js","/assets/datasources-D3U-3Olq.js","/assets/date-cell-D1CuDGgY.js","/assets/date-format-preference-Bd8qHv-f.js","/assets/default-light-DXbpiyRt.js","/assets/defaultLocale-XUIU92sl.js","/assets/diagram-S7CK7UJ4-CT6d3ERW.js","/assets/diagram-UQ7AKVKN-CpMT6Enl.js","/assets/diagram-VSXAHHWV-BbRs6-ZJ.js","/assets/diagram-VX7I27RA-BVebimdH.js","/assets/diagram-Z3DM3KII-9InH6oll.js","/assets/docs-detail-j4oFfLPr.js","/assets/docs-formatting-toolbar-BnYGll55.js","/assets/document-analytics-BpfLRuc0.js","/assets/document-detail-DpN6-1Ou.js","/assets/document-link-BfnfA39_.js","/assets/document-list-CFj8-04S.js","/assets/document-list-utils-ClENUy8o.js","/assets/document-type-meta-Bif_cML4.js","/assets/documents-B06aaqCa.js","/assets/docx-actions-C5DmW7Ab.js","/assets/download-file-CsD3mZbo.js","/assets/draft-store-CCGB_nRw.js","/assets/dropdown-menu-6PMxcvlR.js","/assets/ebnfDiagram-PWID7BFC-BTB4S9PU.js","/assets/en_US-B8ShJejW.js","/assets/en_US-BoR4fQXJ.js","/assets/erDiagram-RLTQ6QDP-HpZasVFN.js","/assets/export-utils-B3n2ZNPk.js","/assets/file-detail-plkfv25q.js","/assets/file-meta-DFZutbDb.js","/assets/fit-to-content-k5fI5Wi0.js","/assets/flowDiagram-HODETNUW-BD6CAPna.js","/assets/folders-8U2LCY2q.js","/assets/font-catalog.full-DmzxXOg7.js","/assets/font-files.data-Cwq_jaWh.js","/assets/font-size-picker-CsRWGo6q.js","/assets/footer-fXQoG70j.js","/assets/ganttDiagram-EL5Y4UJY-Cy66mlCk.js","/assets/generic-file-view-BdF_osCx.js","/assets/gitGraphDiagram-WWUBYQGX-rHGuDeCJ.js","/assets/group-channels-mxcSLO_7.js","/assets/history-panel-DeHz9iCK.js","/assets/image-cache-BvBph9D2.js","/assets/image-object-layer-Ba0O5onX.js","/assets/image-upload-DDtBXAm6.js","/assets/index-BNsAvo7S.js","/assets/index-BPEPoCQk.js","/assets/index-BPMIvcfa.js","/assets/index-CzRc9EEh.js","/assets/index-D3mBcmw_.js","/assets/index-rLUTdiCn.css","/assets/infoDiagram-27XIBGKW-CoJVwo-C.js","/assets/init-CgS7pkjy.js","/assets/input-DIDBLyRp.js","/assets/invite-accept-BQm16ovY.js","/assets/ishikawaDiagram-5VMMS53U-V4kLGYhP.js","/assets/journeyDiagram-3NMN7TZE-C-N06O6u.js","/assets/kanban-definition-UXKFOSKX-BylU5H5p.js","/assets/katex-CxeX4sDO.js","/assets/label-DA9b21JI.js","/assets/lakehouse-feature-D1pfIBYD.js","/assets/layout-BZHwN-kv.js","/assets/layout-Dv4kaC4p.js","/assets/linear-Dtpdpkpj.js","/assets/load-error-state-noGcoHVw.js","/assets/marketing-page-Dfr7kMLH.js","/assets/master-Dt21MuVs.js","/assets/memory-C5AawsFi.js","/assets/mentions-CazDH1Wo.js","/assets/mermaid.core-CRd5Uu6j.js","/assets/migrate-Du8jqXlj.js","/assets/mindmap-definition-YA3MSWOX-C2TuaFgX.js","/assets/mobile-slides-view-DG6IbGoR.js","/assets/notes-detail-3FXcnOxj.js","/assets/notes-editor-engine-m8_i0tsL.js","/assets/notes-toolbar-BsAEaH06.js","/assets/notes-view-qo0e8Dio.js","/assets/ordinal-DoZP7PxM.js","/assets/page-BRc1dSAi.js","/assets/page-Bc4Rvh89.js","/assets/page-DrOumI0T.js","/assets/page-Du6Fol-0.js","/assets/page-DxDheSf2.js","/assets/page-hg-VaLDA.js","/assets/pdf-BO0tOU-W.js","/assets/pdf-Cr5wQOLg.js","/assets/pdf-actions-Corc4m6p.js","/assets/pdf.worker.min-BmVo14Nb.mjs","/assets/pegDiagram-XKGWAZYB-CeIqmSUq.js","/assets/pieDiagram-E7YTZNPT-DYcv5oJM.js","/assets/pivot-editor-panel-DN3jxd_c.js","/assets/platform-eZ4hdlEe.js","/assets/popover-DsEms4s1.js","/assets/pptx-actions-D1tnSGQS.js","/assets/preview-surface-CGZmiiuZ.js","/assets/public-templates-6BEWXEji.js","/assets/purify.es-CRKEofWJ.js","/assets/quadrantDiagram-AXDQQJYC-DkBO72n6.js","/assets/radio-group-DZEJGqcL.js","/assets/railroadDiagram-O6MQD6OU-5ZtQ23-I.js","/assets/requirementDiagram-BXWQKSXE-DOyiv4Sj.js","/assets/revision-preview-CNvCNjdx.js","/assets/ruler-backdrop-D0nj5r2v.js","/assets/sankeyDiagram-P5KCCOFB-DTC7HWjR.js","/assets/scroll-behavior-B9xx5nOm.js","/assets/section-BQpziK8D.js","/assets/section-head-c1LOz9Ep.js","/assets/select-BabAgLOw.js","/assets/send-to-chat-BI7KPH9j.js","/assets/send-to-chat-items-DswTSRRV.js","/assets/separator-CkpKTyri.js","/assets/sequenceDiagram-WJ2MYXX4-vFe1jsxp.js","/assets/shape-CLyJ_P-F.js","/assets/share-links-Cp5SY8sQ.js","/assets/shared-document-DTEOoIrE.js","/assets/sheet-core-Cw_iq4fu.js","/assets/sheet-formula-eval-DKefUfjB.js","/assets/sheet-formula-parser-D3eq9LOD.js","/assets/sheet-import-actions-CY1L__mJ.js","/assets/sheet-view-iXA04d1_.js","/assets/shortcuts-help-dialog-D61MMU-M.js","/assets/side-panel-layout-go5JbZTa.js","/assets/site-header-C_73lIty.js","/assets/sizeCapture-INFHLROL-BVCqnToG.js","/assets/skeleton-Dq-oMz7C.js","/assets/slider-Cl8Wx8pX.js","/assets/slides-detail-CdLWqi9P.js","/assets/slides-editor-engine-CQ6zm492.js","/assets/slides-image-input-BUOqWznd.js","/assets/slides-view-C-Hv644r.js","/assets/stateDiagram-D77RDMKH-pJ-fZeCO.js","/assets/stateDiagram-v2-MP3YSRHH-BF9ovrc8.js","/assets/string-CxpaVyci.js","/assets/swimlanes-42K2YHIH-D-LxgYaQ.js","/assets/swimlanesDiagram-VR7AAH4N-Bmb8cqB5.js","/assets/switch-ipk3QJaH.js","/assets/table-De8GUVe8.js","/assets/table-grid-picker-DdjCyYDo.js","/assets/tabs-CsIGYWuw.js","/assets/template-category-items-PZu132kx.js","/assets/template-gallery-C4ndPZLj.js","/assets/template-landing-DMZhrkAF.js","/assets/template-review-queue-B_g8BQHj.js","/assets/templates-GM6QF4Zx.js","/assets/text-edit-section-AJ9qzjlw.js","/assets/textarea-DCWhvKgq.js","/assets/theme-panel-DST-euGU.js","/assets/theme-toggle-p2ph_BiQ.js","/assets/time-CW99jNmJ.js","/assets/timeline-definition-24CTP7MA-s9WC3VDJ.js","/assets/toggle-DgsaxT2m.js","/assets/toolbar-WhJvdlu4.js","/assets/trash-page-Cse1p9Tb.js","/assets/upload-queue-COPXfNTM.js","/assets/use-chat-KYUAdxuA.js","/assets/use-chat-stream-D2krsntO.js","/assets/use-coarse-pointer-B07936HB.js","/assets/use-mobile-sheet-gestures-ddxlX-AT.js","/assets/use-object-layer-CrHGLjQM.js","/assets/use-presence-updater-CeZeMqFw.js","/assets/use-revision-history-_UYefXIj.js","/assets/use-right-panels-UU6SF3vP.js","/assets/use-send-to-chat-BADocG-m.js","/assets/use-workspace-members-CuxwTRVt.js","/assets/use-workspace-nav-items-rCEHuXVr.js","/assets/vendor-app-Bs_uA3uL.js","/assets/vendor-react-Pz7_aUVz.js","/assets/vendor-ui-BqKa4cGI.js","/assets/vendor-ui-history-BIf2_o7i.js","/assets/vendor-yorkie-BduGgT4F.js","/assets/vennDiagram-4TSXK5OY-DZrmqTrP.js","/assets/views-trend-chart-DqsSLAEG.js","/assets/waffle-logo-Jy785FIG.js","/assets/wardleyDiagram-VM6X3IG4-CjPckhgg.js","/assets/wb-button-CToZ1Y9F.js","/assets/webhook-detail-page-DuEKZ-zv.js","/assets/webhooks-section-BqB5MRrg.js","/assets/workspace-analytics-CH1n4Aoe.js","/assets/workspace-documents-CN0Pc-74.js","/assets/workspace-settings-DX88YIwa.js","/assets/workspace-templates-B2fXP4R0.js","/assets/xychartDiagram-S5SC5T6Z-B3ms5ch7.js","/assets/yield-CrAxwYPA.js","/assets/yorkie-array-remove-BRNnoVsQ.js","/assets/yorkie-board-store-C7Qf0BL0.js","/assets/yorkie-doc-store-D9IfEwX0.js","/assets/yorkie-plain-DQ-f3T6J.js","/assets/yorkie-slides-store-Dl7qw-84.js","/assets/zoom-controller-BAUfKdvW.js"]};

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
