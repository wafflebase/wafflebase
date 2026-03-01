import{r as e}from"./vendor-react-DK0cAKrP.js";const s=768;function M(){const[t,a]=e.useState(void 0);return e.useEffect(()=>{const o=window.matchMedia(`(max-width: ${s-1}px)`),n=()=>{a(window.innerWidth<s)};return o.addEventListener("change",n),a(window.innerWidth<s),()=>o.removeEventListener("change",n)},[]),!!t}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var k={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=(t,a,o,n)=>{const i=e.forwardRef(({color:l="currentColor",size:c=24,stroke:v=2,title:d,className:w,children:r,...m},g)=>e.createElement("svg",{ref:g,...k[t],width:c,height:c,className:["tabler-icon",`tabler-icon-${a}`,w].join(" "),...t==="filled"?{fill:l}:{strokeWidth:v,stroke:l},...m},[d&&e.createElement("title",{key:"svg-title"},d),...n.map(([u,p])=>e.createElement(u,p)),...Array.isArray(r)?r:[r]]));return i.displayName=`${o}`,i};/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var b=h("outline","database","IconDatabase",[["path",{d:"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0",key:"svg-0"}],["path",{d:"M4 6v6a8 3 0 0 0 16 0v-6",key:"svg-1"}],["path",{d:"M4 12v6a8 3 0 0 0 16 0v-6",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var y=h("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);export{b as I,y as a,h as c,M as u};
