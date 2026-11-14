import{c as o}from"./createReactComponent-CP90FAB8.js";import{r as a}from"./vendor-react-C3v5QauN.js";import{a as n}from"./vendor-app-DU5We-AV.js";import{m as t}from"./index-zosScbvy.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.14"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="f2743a90-a165-4c3b-8713-076f27c6282d",e._sentryDebugIdIdentifier="sentry-dbid-f2743a90-a165-4c3b-8713-076f27c6282d")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var f=o("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var c=o("outline","hash","IconHash",[["path",{d:"M5 9l14 0",key:"svg-0"}],["path",{d:"M5 15l14 0",key:"svg-1"}],["path",{d:"M11 4l-4 16",key:"svg-2"}],["path",{d:"M17 4l-4 16",key:"svg-3"}]]);function l(e){const{data:r}=n({queryKey:["workspaces",e],queryFn:()=>t(e),enabled:!!e,staleTime:3e5});return a.useMemo(()=>((r==null?void 0:r.members)??[]).map(s=>({userId:String(s.user.id),username:s.user.username,photo:s.user.photo||void 0})),[r])}export{f as I,c as a,l as u};
