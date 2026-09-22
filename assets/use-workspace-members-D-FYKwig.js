import{c as o}from"./createReactComponent-D0NrgvUE.js";import{r as a}from"./vendor-react-B90fPc98.js";import{u as n}from"./vendor-app-D9HxFTQ5.js";import{o as t}from"./index-BoLWzzL9.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.12"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="a049907b-bbaa-439c-9c1c-d322b549418d",e._sentryDebugIdIdentifier="sentry-dbid-a049907b-bbaa-439c-9c1c-d322b549418d")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var p=o("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var b=o("outline","hash","IconHash",[["path",{d:"M5 9l14 0",key:"svg-0"}],["path",{d:"M5 15l14 0",key:"svg-1"}],["path",{d:"M11 4l-4 16",key:"svg-2"}],["path",{d:"M17 4l-4 16",key:"svg-3"}]]);function l(e){const{data:r}=n({queryKey:["workspaces",e],queryFn:()=>t(e),enabled:!!e,staleTime:3e5});return a.useMemo(()=>((r==null?void 0:r.members)??[]).map(s=>({userId:String(s.user.id),username:s.user.username,photo:s.user.photo||void 0})),[r])}export{p as I,b as a,l as u};
