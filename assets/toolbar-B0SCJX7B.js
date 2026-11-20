import{c as n}from"./createReactComponent-CRcs8KbQ.js";import{r as c,j as l}from"./vendor-react-4EhtGDma.js";import{F as d,J as p}from"./index-hogS8m4M.js";import{S as f}from"./separator-Cu2JMGJp.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.16"};var t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]="ba6c7daa-70ca-4f38-a0c7-eb8ece137aeb",e._sentryDebugIdIdentifier="sentry-dbid-ba6c7daa-70ca-4f38-a0c7-eb8ece137aeb")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var I=n("outline","arrow-back-up","IconArrowBackUp",[["path",{d:"M9 14l-4 -4l4 -4",key:"svg-0"}],["path",{d:"M5 10h11a4 4 0 1 1 0 8h-1",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var x=n("outline","arrow-forward-up","IconArrowForwardUp",[["path",{d:"M15 14l4 -4l-4 -4",key:"svg-0"}],["path",{d:"M19 10h-11a4 4 0 1 0 0 8h1",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var M=n("outline","bold","IconBold",[["path",{d:"M7 5h6a3.5 3.5 0 0 1 0 7h-6z",key:"svg-0"}],["path",{d:"M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var _=n("outline","italic","IconItalic",[["path",{d:"M11 5l6 0",key:"svg-0"}],["path",{d:"M7 19l6 0",key:"svg-1"}],["path",{d:"M14 5l-4 14",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var E=n("outline","photo","IconPhoto",[["path",{d:"M15 8h.01",key:"svg-0"}],["path",{d:"M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z",key:"svg-1"}],["path",{d:"M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5",key:"svg-2"}],["path",{d:"M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3",key:"svg-3"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var R=n("outline","strikethrough","IconStrikethrough",[["path",{d:"M5 12l14 0",key:"svg-0"}],["path",{d:"M16 6.5a4 2 0 0 0 -4 -1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1 -4 -1.5",key:"svg-1"}]]);function h(e){const t=Math.abs(e.scrollLeft),r=t>1,a=e.scrollWidth-e.clientWidth-t>1;return r&&a?"both":r?"start":a?"end":null}function v(){const e=c.useRef(null);return c.useLayoutEffect(()=>{const t=e.current;if(!t)return;const r=()=>{const s=h(t);s?t.dataset.overflow=s:delete t.dataset.overflow};r(),t.addEventListener("scroll",r,{passive:!0});const a=typeof ResizeObserver>"u"?null:new ResizeObserver(r);a==null||a.observe(t);const o=typeof MutationObserver>"u"?null:new MutationObserver(r);return o==null||o.observe(t,{childList:!0,subtree:!0,characterData:!0}),()=>{t.removeEventListener("scroll",r),a==null||a.disconnect(),o==null||o.disconnect()}},[]),e}function T({className:e,children:t,touchTargets:r="scroll",ref:a,...o}){const s=v(),u=c.useCallback(i=>{s.current=i,typeof a=="function"?a(i):a&&(a.current=i)},[s,a]);return l.jsx("div",{ref:u,className:d("flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap","data-[overflow=end]:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]","data-[overflow=start]:[mask-image:linear-gradient(to_left,#000_calc(100%-24px),transparent)]","data-[overflow=both]:[mask-image:linear-gradient(to_right,transparent,#000_24px,#000_calc(100%-24px),transparent)]","pointer-coarse:gap-1 pointer-coarse:py-1.5","pointer-coarse:[&_button]:min-h-11",r==="scroll"&&["pointer-coarse:[&_button:not([class*='min-w-['])]:min-w-11","pointer-coarse:[&_button]:shrink-0"],e),...o,children:t})}function B({className:e,orientation:t,...r}){return l.jsx(f,{...r,orientation:"vertical",className:d("mx-2 !h-5 bg-muted-foreground/40",e)})}const b=p("inline-flex h-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50",{variants:{variant:{icon:"w-7",menu:"gap-0.5 px-1.5"}},defaultVariants:{variant:"icon"}}),g=c.forwardRef(({className:e,type:t="button",variant:r,...a},o)=>l.jsx("button",{ref:o,type:t,className:d(b({variant:r}),e),...a}));g.displayName="ToolbarButton";export{M as I,T,_ as a,I as b,x as c,B as d,R as e,E as f,g};
