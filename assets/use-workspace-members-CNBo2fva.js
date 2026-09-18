import{c as o}from"./createReactComponent-D0NrgvUE.js";import{r as n}from"./vendor-react-B90fPc98.js";import{u as t}from"./vendor-app-D9HxFTQ5.js";import{x as a}from"./index-BNsIbdyB.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.12"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="50c9c2dd-6f26-40ab-8ef5-289e3b6c44b7",e._sentryDebugIdIdentifier="sentry-dbid-50c9c2dd-6f26-40ab-8ef5-289e3b6c44b7")}catch{}})();/**
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
//# sourceMappingURL=use-workspace-members-CNBo2fva.js.map
