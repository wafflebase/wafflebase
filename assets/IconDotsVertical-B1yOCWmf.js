import{r,j as f}from"./vendor-react-DK0cAKrP.js";import{p as k}from"./vendor-ui-6OfqybyF.js";import{c as x}from"./index-uYfq85kk.js";const i=768;function I(){const[t,e]=r.useState(void 0);return r.useEffect(()=>{const a=window.matchMedia(`(max-width: ${i-1}px)`),o=()=>{e(window.innerWidth<i)};return a.addEventListener("change",o),e(window.innerWidth<i),()=>a.removeEventListener("change",o)},[]),!!t}function C({className:t,orientation:e="horizontal",decorative:a=!0,...o}){return f.jsx(k,{"data-slot":"separator-root",decorative:a,orientation:e,className:x("bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",t),...o})}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var b={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=(t,e,a,o)=>{const s=r.forwardRef(({color:l="currentColor",size:c=24,stroke:m=2,title:d,className:v,children:n,...p},u)=>r.createElement("svg",{ref:u,...b[t],width:c,height:c,className:["tabler-icon",`tabler-icon-${e}`,v].join(" "),...t==="filled"?{fill:l}:{strokeWidth:m,stroke:l},...p},[d&&r.createElement("title",{key:"svg-title"},d),...o.map(([w,g])=>r.createElement(w,g)),...Array.isArray(n)?n:[n]]));return s.displayName=`${a}`,s};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var j=h("outline","database","IconDatabase",[["path",{d:"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0",key:"svg-0"}],["path",{d:"M4 6v6a8 3 0 0 0 16 0v-6",key:"svg-1"}],["path",{d:"M4 12v6a8 3 0 0 0 16 0v-6",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var L=h("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);export{j as I,C as S,L as a,h as c,I as u};
