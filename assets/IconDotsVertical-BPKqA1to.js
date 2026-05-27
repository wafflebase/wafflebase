import{r as e}from"./vendor-react-7yXhJWJb.js";const a=768;function E(){const[t,o]=e.useState(void 0);return e.useEffect(()=>{const n=window.matchMedia(`(max-width: ${a-1}px)`),r=()=>{o(window.innerWidth<a)};return n.addEventListener("change",r),o(window.innerWidth<a),()=>n.removeEventListener("change",r)},[]),!!t}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var p={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=(t,o,n,r)=>{const s=e.forwardRef(({color:l="currentColor",size:c=24,stroke:h=2,title:d,className:w,children:i,...m},u)=>e.createElement("svg",{ref:u,...p[t],width:c,height:c,className:["tabler-icon",`tabler-icon-${o}`,w].join(" "),...t==="filled"?{fill:l}:{strokeWidth:h,stroke:l},...m},[d&&e.createElement("title",{key:"svg-title"},d),...r.map(([v,g])=>e.createElement(v,g)),...Array.isArray(i)?i:[i]]));return s.displayName=`${n}`,s};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var x=f("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);export{x as I,f as c,E as u};
