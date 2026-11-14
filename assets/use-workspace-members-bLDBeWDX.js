import{c as o}from"./createReactComponent-CP90FAB8.js";import{r as n}from"./vendor-react-C3v5QauN.js";import{u as t}from"./vendor-app-Dz3Ax4dI.js";import{o as a}from"./index-ZV735uX8.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.14"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="a7b4a829-03cc-483f-b0ec-b3d6d27d7e53",e._sentryDebugIdIdentifier="sentry-dbid-a7b4a829-03cc-483f-b0ec-b3d6d27d7e53")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var p=o("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var f=o("outline","hash","IconHash",[["path",{d:"M5 9l14 0",key:"svg-0"}],["path",{d:"M5 15l14 0",key:"svg-1"}],["path",{d:"M11 4l-4 16",key:"svg-2"}],["path",{d:"M17 4l-4 16",key:"svg-3"}]]);function l(e){const{data:r}=t({queryKey:["workspaces",e],queryFn:()=>a(e),enabled:!!e,staleTime:3e5});return n.useMemo(()=>((r==null?void 0:r.members)??[]).map(s=>({userId:String(s.user.id),username:s.user.username,photo:s.user.photo||void 0})),[r])}export{p as I,f as a,l as u};
