import{c as l}from"./createReactComponent-BvFaMySi.js";import{p as r}from"./vendor-app-B6REicxY.js";import{j as a,r as c}from"./vendor-react-CzZy1dUF.js";import{F as g}from"./index-CwhKzdIf.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.15"};var t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]="8585acdc-d14b-4b92-90d7-60c825c50604",e._sentryDebugIdIdentifier="sentry-dbid-8585acdc-d14b-4b92-90d7-60c825c50604")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var v=l("outline","align-center","IconAlignCenter",[["path",{d:"M4 6l16 0",key:"svg-0"}],["path",{d:"M8 12l8 0",key:"svg-1"}],["path",{d:"M6 18l12 0",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var m=l("outline","align-left","IconAlignLeft",[["path",{d:"M4 6l16 0",key:"svg-0"}],["path",{d:"M4 12l10 0",key:"svg-1"}],["path",{d:"M4 18l14 0",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var C=l("outline","align-right","IconAlignRight",[["path",{d:"M4 6l16 0",key:"svg-0"}],["path",{d:"M10 12l10 0",key:"svg-1"}],["path",{d:"M6 18l14 0",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var B=l("outline","palette","IconPalette",[["path",{d:"M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25",key:"svg-0"}],["path",{d:"M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}],["path",{d:"M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-3"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var k=l("outline","typography","IconTypography",[["path",{d:"M4 20l3 0",key:"svg-0"}],["path",{d:"M14 20l7 0",key:"svg-1"}],["path",{d:"M6.9 15l6.9 0",key:"svg-2"}],["path",{d:"M10.2 6.3l5.8 13.7",key:"svg-3"}],["path",{d:"M5 20l6 -16l2 0l7 16",key:"svg-4"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var E=l("outline","underline","IconUnderline",[["path",{d:"M7 5v5a5 5 0 0 0 10 0v-5",key:"svg-0"}],["path",{d:"M5 19h14",key:"svg-1"}]]);const D=["#000000",r.neutrals.light.ink,"#4A3826",r.neutrals.light.sub,"#857060","#A89784","#CFC3B0","#FFFFFF",r.syrupDeep,r.syrup,r.syrupBright,r.butter,r.berry,r.berryBright,r.leaf,r.leafBright,"#1A73E8","#039BE5","#00897B","#00BCD4","#3F51B5","#673AB7","#7B1FA2","#D81B60","#4E342E","#795548","#5D4037","#607D8B","#455A64","#FF5722","#FFC107","#4CAF50"],x=["#FFFFFF",r.neutrals.light.paper,r.neutrals.light.bg,"#F4ECDB",r.neutrals.light.rule,"#D7C5A0","#BFA67C","#A89784","#FBE8A8","#F4E4D2","#FAD7B0","#F8DADC","#F4C2C5","#E0EAD0","#C7DAA9","#F0E6CC","#D9E8FB","#BBD9F5","#CFE8E5","#B0DAD0","#DCDFF4","#C1C6E8","#E6D7EC","#F8D7E2","#F5F5F5","#E8E8E8","#D5D5D5","#BBBBBB","#FFE0B2","#FFECB3","#C8E6C9","#B2DFDB"];function p({selected:e=!1,className:t}){return a.jsx("span",{"data-testid":"none-swatch","aria-hidden":"true",className:`relative inline-block h-5 w-5 shrink-0 overflow-hidden rounded-sm border bg-white ${e?"border-foreground ring-2 ring-ring/50":"border-border"} ${t??""}`,children:a.jsx("svg",{viewBox:"0 0 20 20",className:"absolute inset-0 h-full w-full",preserveAspectRatio:"none",children:a.jsx("line",{x1:"2",y1:"18",x2:"18",y2:"2",stroke:"#EA4335",strokeWidth:"1.5"})})})}function h({color:e,label:t,onClick:o,selected:n,title:i}){return a.jsx("button",{type:"button","aria-label":t,"aria-pressed":n,title:i??t,onClick:o,className:g("h-5 w-5 cursor-pointer rounded-sm border transition-transform hover:scale-125",n?"border-foreground ring-2 ring-ring/50":"border-border"),style:{backgroundColor:e}})}function A({colors:e,onSelect:t,onReset:o,noneLabel:n="Reset",colorKind:i="color"}){return a.jsxs(a.Fragment,{children:[a.jsxs("button",{type:"button","data-none-control":!0,"aria-label":n,className:"mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted",onClick:o,children:[a.jsx(p,{}),n]}),a.jsx("div",{className:"grid grid-cols-8 gap-1",children:e.map(s=>a.jsx(h,{color:s,label:`Select ${i} ${s}`,title:s,onClick:()=>t(s)},s))})]})}const u=c.forwardRef(({icon:e,color:t,label:o,className:n,disabled:i,...s},d)=>a.jsxs("button",{ref:d,type:"button","aria-label":o,disabled:i,className:["inline-flex h-7 w-7 cursor-pointer flex-col items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50",n??""].filter(Boolean).join(" "),...s,children:[a.jsx("span",{className:"flex h-3.5 items-center justify-center",children:e}),a.jsx("span",{className:"mt-0.5 block h-[3px] w-4 rounded-sm border",style:{backgroundColor:t??"transparent",borderColor:t||"var(--border)"}})]}));u.displayName="ColorSwatchButton";export{x as B,u as C,B as I,p as N,D as T,k as a,A as b,E as c,v as d,C as e,m as f,h as g};
