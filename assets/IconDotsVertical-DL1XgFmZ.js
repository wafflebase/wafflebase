import{r as i,j as r}from"./vendor-react-B8NMt2sn.js";import{p as b,q as k,r as y,s as j,u as M,v as E,A as I}from"./vendor-ui-BfXYXQ1K.js";import{c as p}from"./utils-DjqsqOe8.js";const s=768;function R(){const[t,o]=i.useState(void 0);return i.useEffect(()=>{const a=window.matchMedia(`(max-width: ${s-1}px)`),e=()=>{o(window.innerWidth<s)};return a.addEventListener("change",e),o(window.innerWidth<s),()=>a.removeEventListener("change",e)},[]),!!t}function L({className:t,orientation:o="horizontal",decorative:a=!0,...e}){return r.jsx(b,{"data-slot":"separator-root",decorative:a,orientation:o,className:p("bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",t),...e})}function C({delayDuration:t=0,...o}){return r.jsx(k,{"data-slot":"tooltip-provider",delayDuration:t,...o})}function B({...t}){return r.jsx(C,{children:r.jsx(y,{"data-slot":"tooltip",...t})})}function D({...t}){return r.jsx(j,{"data-slot":"tooltip-trigger",...t})}function P({className:t,sideOffset:o=0,children:a,...e}){return r.jsx(M,{children:r.jsxs(E,{"data-slot":"tooltip-content",sideOffset:o,className:p("bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",t),...e,children:[a,r.jsx(I,{className:"bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]"})]})})}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var T={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=(t,o,a,e)=>{const l=i.forwardRef(({color:d="currentColor",size:c=24,stroke:h=2,title:m,className:f,children:n,...g},v)=>i.createElement("svg",{ref:v,...T[t],width:c,height:c,className:["tabler-icon",`tabler-icon-${o}`,f].join(" "),...t==="filled"?{fill:d}:{strokeWidth:h,stroke:d},...g},[m&&i.createElement("title",{key:"svg-title"},m),...e.map(([x,w])=>i.createElement(x,w)),...Array.isArray(n)?n:[n]]));return l.displayName=`${a}`,l};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var W=u("outline","database","IconDatabase",[["path",{d:"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0",key:"svg-0"}],["path",{d:"M4 6v6a8 3 0 0 0 16 0v-6",key:"svg-1"}],["path",{d:"M4 12v6a8 3 0 0 0 16 0v-6",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var S=u("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);export{W as I,L as S,C as T,B as a,D as b,u as c,P as d,S as e,R as u};
