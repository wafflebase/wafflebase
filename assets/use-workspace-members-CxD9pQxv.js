import{c as s}from"./createReactComponent-C_ZbOQq8.js";import{r as a}from"./vendor-react-Br1PIuaQ.js";import{u as t}from"./vendor-app-_5fnz3xP.js";import{o as n}from"./index-CgON_D7x.js";/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var c=s("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var i=s("outline","hash","IconHash",[["path",{d:"M5 9l14 0",key:"svg-0"}],["path",{d:"M5 15l14 0",key:"svg-1"}],["path",{d:"M11 4l-4 16",key:"svg-2"}],["path",{d:"M17 4l-4 16",key:"svg-3"}]]);function v(r){const{data:e}=t({queryKey:["workspaces",r],queryFn:()=>n(r),enabled:!!r,staleTime:3e5});return a.useMemo(()=>((e==null?void 0:e.members)??[]).map(o=>({userId:String(o.user.id),username:o.user.username,photo:o.user.photo||void 0})),[e])}export{i as I,c as a,v as u};
