import{B as i,L as s,A as n,P as o,S as l}from"./scatter-chart-renderer-CQYxcCa8.js";import{I as c}from"./sheet-view-B6w3m8wv.js";import{c as t}from"./createReactComponent-s27Nx8vx.js";/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var h=t("outline","chart-area","IconChartArea",[["path",{d:"M4 19l16 0",key:"svg-0"}],["path",{d:"M4 15l4 -6l4 2l4 -5l4 4l0 5l-16 0",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var d=t("outline","chart-dots","IconChartDots",[["path",{d:"M3 3v18h18",key:"svg-0"}],["path",{d:"M9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",key:"svg-1"}],["path",{d:"M19 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",key:"svg-2"}],["path",{d:"M14 15m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",key:"svg-3"}],["path",{d:"M10.16 10.62l2.34 2.88",key:"svg-4"}],["path",{d:"M15.088 13.328l2.837 -4.586",key:"svg-5"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var u=t("outline","chart-line","IconChartLine",[["path",{d:"M4 19l16 0",key:"svg-0"}],["path",{d:"M4 15l4 -6l4 2l4 -5l4 4",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var p=t("outline","chart-pie","IconChartPie",[["path",{d:"M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0 -1 -1h-6.8a2 2 0 0 1 -2 -2v-7a.9 .9 0 0 0 -1 -.8",key:"svg-0"}],["path",{d:"M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1 -1 -1v-4.5",key:"svg-1"}]]);const r=new Map,g=[{type:"bar",label:"Bar chart",icon:c,category:"cartesian",editorCapabilities:{xAxis:!0,series:!0,multiSeries:!0,gridlines:!0,legendPosition:!0},renderer:i},{type:"line",label:"Line chart",icon:u,category:"cartesian",editorCapabilities:{xAxis:!0,series:!0,multiSeries:!0,gridlines:!0,legendPosition:!0},renderer:s},{type:"area",label:"Area chart",icon:h,category:"cartesian",editorCapabilities:{xAxis:!0,series:!0,multiSeries:!0,gridlines:!0,legendPosition:!0},renderer:n},{type:"pie",label:"Pie chart",icon:p,category:"radial",editorCapabilities:{xAxis:!0,series:!0,multiSeries:!1,gridlines:!1,legendPosition:!0},renderer:o},{type:"scatter",label:"Scatter chart",icon:d,category:"scatter",editorCapabilities:{xAxis:!0,series:!0,multiSeries:!0,gridlines:!0,legendPosition:!0},renderer:l}];for(const e of g){if(r.has(e.type))throw new Error(`Duplicate chart type in registry: ${e.type}`);r.set(e.type,e)}function m(e){const a=r.get(e);if(!a)throw new Error(`Unknown chart type: ${e}`);return a}function k(){return[...r.values()]}export{k as a,m as g};
