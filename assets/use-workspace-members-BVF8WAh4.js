import{c as n}from"./createReactComponent-BKcBXntf.js";import{r as s}from"./vendor-react-CZUzcXoN.js";import{b as t}from"./vendor-app-gK6lG1RO.js";import{n as a}from"./index-BCUu7-zU.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.17"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="83700d08-5506-4b18-8ed5-1aa0c745943e",e._sentryDebugIdIdentifier="sentry-dbid-83700d08-5506-4b18-8ed5-1aa0c745943e")}catch{}})();/**
 * @license @tabler/icons-react v3.31.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var f=n("outline","chevron-up","IconChevronUp",[["path",{d:"M6 15l6 -6l6 6",key:"svg-0"}]]);function c(e){const{data:r}=t({queryKey:["workspaces",e],queryFn:()=>a(e),enabled:!!e,staleTime:3e5});return s.useMemo(()=>((r==null?void 0:r.members)??[]).map(o=>({userId:String(o.user.id),username:o.user.username,photo:o.user.photo||void 0})),[r])}export{f as I,c as u};
