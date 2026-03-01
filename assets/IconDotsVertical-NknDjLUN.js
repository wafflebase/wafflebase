import{r,j as i}from"./vendor-react-Bg6UneQK.js";import{k as b,l as k,m as y,n as M,o as j,A as E}from"./vendor-ui-DfYFMF-e.js";import{c as p}from"./index-tXZjcRN5.js";const s=768;function A(){const[t,a]=r.useState(void 0);return r.useEffect(()=>{const e=window.matchMedia(`(max-width: ${s-1}px)`),o=()=>{a(window.innerWidth<s)};return e.addEventListener("change",o),a(window.innerWidth<s),()=>e.removeEventListener("change",o)},[]),!!t}function N({className:t,orientation:a="horizontal",decorative:e=!0,...o}){return i.jsx(b,{"data-slot":"separator-root",decorative:e,orientation:a,className:p("bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",t),...o})}function R({...t}){return i.jsx(k,{"data-slot":"tooltip",...t})}function L({...t}){return i.jsx(y,{"data-slot":"tooltip-trigger",...t})}function B({className:t,sideOffset:a=0,children:e,...o}){return i.jsx(M,{children:i.jsxs(j,{"data-slot":"tooltip-content",sideOffset:a,className:p("bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",t),...o,children:[e,i.jsx(E,{className:"bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]"})]})})}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var I={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=(t,a,e,o)=>{const l=r.forwardRef(({color:d="currentColor",size:c=24,stroke:h=2,title:m,className:f,children:n,...g},v)=>r.createElement("svg",{ref:v,...I[t],width:c,height:c,className:["tabler-icon",`tabler-icon-${a}`,f].join(" "),...t==="filled"?{fill:d}:{strokeWidth:h,stroke:d},...g},[m&&r.createElement("title",{key:"svg-title"},m),...o.map(([x,w])=>r.createElement(x,w)),...Array.isArray(n)?n:[n]]));return l.displayName=`${e}`,l};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var D=u("outline","database","IconDatabase",[["path",{d:"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0",key:"svg-0"}],["path",{d:"M4 6v6a8 3 0 0 0 16 0v-6",key:"svg-1"}],["path",{d:"M4 12v6a8 3 0 0 0 16 0v-6",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var W=u("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);export{D as I,N as S,R as T,L as a,B as b,u as c,W as d,A as u};
