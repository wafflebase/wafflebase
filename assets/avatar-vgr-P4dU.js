import{r as i,j as s}from"./vendor-react-Bg9yBbjn.js";import{c}from"./createReactComponent-D7HBe0Tg.js";import{q as l,r as d,F as m}from"./vendor-ui-CbLt2sQg.js";import{c as r}from"./index-DXKUBhX-.js";const t=768;function h(){const[e,a]=i.useState(void 0);return i.useEffect(()=>{const n=window.matchMedia(`(max-width: ${t-1}px)`),o=()=>{a(window.innerWidth<t)};return n.addEventListener("change",o),a(window.innerWidth<t),()=>n.removeEventListener("change",o)},[]),!!e}/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var g=c("outline","database","IconDatabase",[["path",{d:"M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0",key:"svg-0"}],["path",{d:"M4 6v6a8 3 0 0 0 16 0v-6",key:"svg-1"}],["path",{d:"M4 12v6a8 3 0 0 0 16 0v-6",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var b=c("outline","dots-vertical","IconDotsVertical",[["path",{d:"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-0"}],["path",{d:"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-1"}],["path",{d:"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",key:"svg-2"}]]);function x({className:e,...a}){return s.jsx(l,{"data-slot":"avatar",className:r("relative flex size-8 shrink-0 overflow-hidden rounded-full",e),...a})}function I({className:e,...a}){return s.jsx(d,{"data-slot":"avatar-image",className:r("aspect-square size-full",e),...a})}function M({className:e,...a}){return s.jsx(m,{"data-slot":"avatar-fallback",className:r("bg-muted flex size-full items-center justify-center rounded-full",e),...a})}export{x as A,g as I,I as a,M as b,b as c,h as u};
