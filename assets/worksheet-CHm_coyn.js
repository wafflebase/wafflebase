import{c as n}from"./createReactComponent-s27Nx8vx.js";import{g as t,h as o}from"./index-BRWuGCZE.js";/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var l=n("outline","copy","IconCopy",[["path",{d:"M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z",key:"svg-0"}],["path",{d:"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",key:"svg-1"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var p=n("outline","table","IconTable",[["path",{d:"M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z",key:"svg-0"}],["path",{d:"M3 10h18",key:"svg-1"}],["path",{d:"M10 3v18",key:"svg-2"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var d=n("outline","trash","IconTrash",[["path",{d:"M4 7l16 0",key:"svg-0"}],["path",{d:"M10 11l0 6",key:"svg-1"}],["path",{d:"M14 11l0 6",key:"svg-2"}],["path",{d:"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12",key:"svg-3"}],["path",{d:"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",key:"svg-4"}]]);async function k(a,e,i){const r=await o(`https://wafflebase-api.yorkie.dev/documents/${a}/share-links`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:e,expiration:i})});return await t(r,"Failed to create share link"),r.json()}async function v(a){const e=await o(`https://wafflebase-api.yorkie.dev/documents/${a}/share-links`);return await t(e,"Failed to fetch share links"),e.json()}async function y(a){const e=await o(`https://wafflebase-api.yorkie.dev/share-links/${a}`,{method:"DELETE"});await t(e,"Failed to delete share link")}async function f(a){const e=await fetch(`https://wafflebase-api.yorkie.dev/share-links/${a}/resolve`);return await t(e,"Invalid share link",{statusMessages:{410:"Share link has expired"}}),e.json()}const s="tab-1",g={tabs:{[s]:{id:s,name:"Sheet1",type:"sheet"}},tabOrder:[s],sheets:{[s]:{sheet:{},rowHeights:{},colWidths:{},colStyles:{},rowStyles:{},conditionalFormats:[],merges:{},charts:{},frozenRows:0,frozenCols:0}}};export{l as I,d as a,p as b,k as c,y as d,v as g,g as i,f as r};
