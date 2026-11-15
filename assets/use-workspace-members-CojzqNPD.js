import{c as o}from"./createReactComponent-BMhyl2XP.js";import{r as n}from"./vendor-react-BsPhIBch.js";import{a}from"./vendor-app-MhHjrrn_.js";import{n as t}from"./index-EHiewU4y.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.14"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="4f8a683d-2d61-4d42-9530-a46b08db4968",e._sentryDebugIdIdentifier="sentry-dbid-4f8a683d-2d61-4d42-9530-a46b08db4968")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var f=o("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var l=o("outline","hash","IconHash",[["path",{d:"M5 9l14 0",key:"svg-0"}],["path",{d:"M5 15l14 0",key:"svg-1"}],["path",{d:"M11 4l-4 16",key:"svg-2"}],["path",{d:"M17 4l-4 16",key:"svg-3"}]]);function y(e){const{data:r}=a({queryKey:["workspaces",e],queryFn:()=>t(e),enabled:!!e,staleTime:3e5});return n.useMemo(()=>((r==null?void 0:r.members)??[]).map(s=>({userId:String(s.user.id),username:s.user.username,photo:s.user.photo||void 0})),[r])}export{f as I,l as a,y as u};
