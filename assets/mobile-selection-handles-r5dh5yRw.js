import{c as e}from"./createReactComponent-s27Nx8vx.js";import{r as I,j as o}from"./vendor-react-DK0cAKrP.js";/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var T=e("outline","check","IconCheck",[["path",{d:"M5 12l5 5l10 -10",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var z=e("outline","clipboard","IconClipboard",[["path",{d:"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",key:"svg-0"}],["path",{d:"M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var L=e("outline","column-insert-left","IconColumnInsertLeft",[["path",{d:"M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z",key:"svg-0"}],["path",{d:"M5 12l4 0",key:"svg-1"}],["path",{d:"M7 10l0 4",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var j=e("outline","column-insert-right","IconColumnInsertRight",[["path",{d:"M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z",key:"svg-0"}],["path",{d:"M15 12l4 0",key:"svg-1"}],["path",{d:"M17 10l0 4",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var X=e("outline","cut","IconCut",[["path",{d:"M7 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",key:"svg-0"}],["path",{d:"M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",key:"svg-1"}],["path",{d:"M9.15 14.85l8.85 -10.85",key:"svg-2"}],["path",{d:"M6 4l8.85 10.85",key:"svg-3"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var O=e("outline","eye-off","IconEyeOff",[["path",{d:"M10.585 10.587a2 2 0 0 0 2.829 2.828",key:"svg-0"}],["path",{d:"M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87",key:"svg-1"}],["path",{d:"M3 3l18 18",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var A=e("outline","row-insert-bottom","IconRowInsertBottom",[["path",{d:"M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z",key:"svg-0"}],["path",{d:"M12 15l0 4",key:"svg-1"}],["path",{d:"M14 17l-4 0",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var H=e("outline","row-insert-top","IconRowInsertTop",[["path",{d:"M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z",key:"svg-0"}],["path",{d:"M12 9v-4",key:"svg-1"}],["path",{d:"M10 7l4 0",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var Y=e("outline","x","IconX",[["path",{d:"M18 6l-12 12",key:"svg-0"}],["path",{d:"M6 6l12 12",key:"svg-1"}]]);const n=8,x=44;function B({spreadsheet:t,renderVersion:E}){const s=I.useRef(null),v=I.useCallback(i=>d=>{d.stopPropagation(),s.current=i;const g=t.getSelectionRangeOrActiveCell(),p=g?g[1]:null,m=f=>{f.preventDefault();const y=f.touches[0],k=t.cellRefFromPoint(y.clientX,y.clientY);s.current==="end"?t.selectEnd(k):p&&(t.selectStart(p),t.selectEnd(k))},l=()=>{s.current=null,document.removeEventListener("touchmove",m),document.removeEventListener("touchend",l),document.removeEventListener("touchcancel",l)};document.addEventListener("touchmove",m,{passive:!1}),document.addEventListener("touchend",l),document.addEventListener("touchcancel",l)},[t]),r=t.getSelectionRangeOrActiveCell();if(!r)return null;const a=t.getGridViewportRect(),h=t.getCellRect(r[0]),c=t.getCellRect(r[1]),M=a.left+h.left-n/2,R=a.top+h.top-n/2,C=a.left+c.left+c.width-n/2,b=a.top+c.top+c.height-n/2,u=(i,d)=>({position:"absolute",left:i,top:d,boxSizing:"content-box",width:n,height:n,padding:(x-n)/2,margin:-36/2,zIndex:12,touchAction:"none"});return o.jsxs(o.Fragment,{children:[o.jsx("div",{style:u(M,R),onTouchStart:v("start"),children:o.jsx("div",{className:"h-full w-full rounded-full bg-primary"})}),o.jsx("div",{style:u(C,b),onTouchStart:v("end"),children:o.jsx("div",{className:"h-full w-full rounded-full bg-primary"})})]})}export{Y as I,B as M,T as a,X as b,z as c,H as d,A as e,O as f,L as g,j as h};
