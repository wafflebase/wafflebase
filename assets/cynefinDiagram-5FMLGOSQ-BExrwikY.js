import{p as ht}from"./chunk-JWPE2WC7-CFiUijyI.js";import{s as xt,g as bt,q as $t,p as wt,a as Ct,b as Dt,_ as i,l as O,G as vt,d as Tt,r as kt,D as U,A as Q,E as At,H as ot}from"./mermaid.core-DlRoUGG_.js";import{p as Bt}from"./cynefin-OW5HDTMX-B_O-xDwA.js";import"./slides-editor-engine-DGm-BrBU.js";import"./sheet-core-CmSM58JS.js";import"./sheet-formula-eval-BNq4TmCx.js";import"./sheet-formula-parser-D0I0zm21.js";import"./vendor-react-B90fPc98.js";import"./purify.es-Du9o_Ba4.js";import"./string-DJXsATgL.js";(function(){try{var t=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};t.SENTRY_RELEASE={id:"0.6.12"};var e=new t.Error().stack;e&&(t._sentryDebugIds=t._sentryDebugIds||{},t._sentryDebugIds[e]="290c4e5f-ad8b-42f8-a8aa-61016251d676",t._sentryDebugIdIdentifier="sentry-dbid-290c4e5f-ad8b-42f8-a8aa-61016251d676")}catch{}})();var rt=i(()=>({domains:new Map,transitions:[]}),"createDefaultData"),V=rt(),St=i(()=>V.domains,"getDomains"),It=i(()=>V.transitions,"getTransitions"),Mt=i(t=>{if(t)for(const e of t){const n=e.domain,a=(e.items??[]).map(c=>({label:c.label}));V.domains.set(n,{name:n,items:a})}},"setDomains"),Lt=i(t=>{t&&(V.transitions=t.filter(e=>e.from===e.to?(O.warn(`Cynefin: self-loop transition on domain "${e.from}" is not meaningful and will be skipped.`),!1):!0).map(e=>({from:e.from,to:e.to,label:e.label||void 0})))},"setTransitions"),_t=i(()=>U({...At.cynefin,...Q().cynefin}),"getConfig"),zt=i(()=>{kt(),V=rt()},"clear"),Y={getDomains:St,getTransitions:It,setDomains:Mt,setTransitions:Lt,getConfig:_t,clear:zt,setAccTitle:Dt,getAccTitle:Ct,setDiagramTitle:wt,getDiagramTitle:$t,getAccDescription:bt,setAccDescription:xt},Et=i(t=>{ht(t,Y),Y.setDomains(t.domains),Y.setTransitions(t.transitions)},"populate"),Nt={parse:i(async t=>{const e=await Bt("cynefin",t);O.debug(e),Et(e)},"parse")};function H(t){let e=t+1831565813|0;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}i(H,"seededRandom");function it(t){let e=0;for(let n=0;n<t.length;n++){const a=t.charCodeAt(n);e=(e<<5)-e+a,e|=0}return e}i(it,"hashString");function st(t,e){return typeof t=="number"&&Number.isFinite(t)&&t!==0?t:it(e)}i(st,"resolveSeed");function ct(t,e,n,a){const c=t/2,m=a??t*.015,D=7,N=e/D,d=[];for(let o=0;o<=D;o++){const p=H(n+o*17)*m*2-m;d.push({x:c+p,y:o*N})}let v=`M${d[0].x},${d[0].y}`;for(let o=0;o<d.length-1;o++){const p=d[o],s=d[o+1],f=(p.y+s.y)/2,$=o%2===0?1:-1,g=m*1.5*$*H(n+o*31+7),P=p.x+g,R=f,W=s.x-g;v+=` C${P},${R} ${W},${f} ${s.x},${s.y}`}return v}i(ct,"generateFoldPath");function lt(t,e,n,a){const c=e/2,m=a??e*.015,D=7,N=t/D,d=[];for(let o=0;o<=D;o++){const p=H(n+o*23)*m*2-m;d.push({x:o*N,y:c+p})}let v=`M${d[0].x},${d[0].y}`;for(let o=0;o<d.length-1;o++){const p=d[o],s=d[o+1],f=(p.x+s.x)/2,$=o%2===0?1:-1,g=m*1.5*$*H(n+o*37+11),P=f,R=p.y+g,W=f,M=s.y-g;v+=` C${P},${R} ${W},${M} ${s.x},${s.y}`}return v}i(lt,"generateHorizontalBoundary");function dt(t,e){const n=t/2,a=e*.5,c=e,m=t*.03;return[`M${n},${a}`,`C${n+m},${a+(c-a)*.2}`,`${n-m*1.5},${a+(c-a)*.55}`,`${n+m*.5},${a+(c-a)*.75}`,`C${n-m},${a+(c-a)*.85}`,`${n+m*.3},${a+(c-a)*.95}`,`${n},${c}`].join(" ")}i(dt,"generateCliffPath");function ft(t,e,n,a){return[`M${t-n},${e}`,`A${n},${a} 0 1,1 ${t+n},${e}`,`A${n},${a} 0 1,1 ${t-n},${e}`,"Z"].join(" ")}i(ft,"generateConfusionPath");var at={complex:{model:"Probe → Sense → Respond",practice:"Emergent Practices"},complicated:{model:"Sense → Analyse → Respond",practice:"Good Practices"},clear:{model:"Sense → Categorise → Respond",practice:"Best Practices"},chaotic:{model:"Act → Sense → Respond",practice:"Novel Practices"},confusion:{model:"",practice:"Disorder"}},Pt=i((t,e)=>{const n=t/2,a=e/2;return{complex:{cx:n/2,cy:a/2,x:0,y:0,w:n,h:a},complicated:{cx:n+n/2,cy:a/2,x:n,y:0,w:n,h:a},chaotic:{cx:n/2,cy:a+a/2,x:0,y:a,w:n,h:a},clear:{cx:n+n/2,cy:a+a/2,x:n,y:a,w:n,h:a},confusion:{cx:n,cy:a,x:n*.7,y:a*.7,w:n*.6,h:a*.6}}},"getDomainLayouts"),Rt=i(()=>{const t=ot(),e=Q();return U(t,e.themeVariables).cynefin},"getCynefinDomainColors"),q=3,Wt=i((t,e,n,a)=>{const c=a.db,m=c.getDomains(),D=c.getTransitions(),N=c.getDiagramTitle(),d=c.getAccTitle(),v=c.getAccDescription(),o=c.getConfig(),p=Rt();O.debug("Rendering Cynefin diagram");const s=o.width,f=o.height,$=o.padding,g=o.showDomainDescriptions,P=o.boundaryAmplitude,R=s+$*2,W=f+$*2,M={complex:p.complexBg,complicated:p.complicatedBg,clear:p.clearBg,chaotic:p.chaoticBg,confusion:p.confusionBg},T=vt(e);Tt(T,W,R,o.useMaxWidth??!0),T.attr("viewBox",`0 0 ${R} ${W}`),d&&T.append("title").text(d),v&&T.append("desc").text(v);const k=T.append("g").attr("transform",`translate(${$}, ${$})`),F=Pt(s,f),Z=st(o.seed,e),mt=k.append("g").attr("class","cynefin-backgrounds"),X=["complex","complicated","chaotic","clear"];for(const l of X){const r=F[l];mt.append("rect").attr("class","cynefinDomain").attr("x",r.x).attr("y",r.y).attr("width",r.w).attr("height",r.h).attr("fill",M[l]).attr("fill-opacity",.4).attr("stroke","none")}const j=k.append("g").attr("class","cynefin-boundaries");j.append("path").attr("class","cynefinBoundary").attr("d",ct(s,f,Z,P)).attr("fill","none"),j.append("path").attr("class","cynefinBoundary").attr("d",lt(s,f,Z+100,P)).attr("fill","none"),j.append("path").attr("class","cynefinCliff").attr("d",dt(s,f)).attr("fill","none");const pt=s*.15,yt=f*.15;k.append("path").attr("class","cynefinConfusion").attr("d",ft(s/2,f/2,pt,yt)).attr("fill",M.confusion).attr("fill-opacity",.5);const J=k.append("g").attr("class","cynefin-labels");for(const l of X){const r=F[l];J.append("text").attr("class","cynefinDomainLabel").attr("x",r.cx).attr("y",g?r.cy-30:r.cy).attr("text-anchor","middle").attr("dominant-baseline","middle").text(l.charAt(0).toUpperCase()+l.slice(1))}if(J.append("text").attr("class","cynefinDomainLabel").attr("x",s/2).attr("y",g?f/2-10:f/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text("Confusion"),g){const l=k.append("g").attr("class","cynefin-subtitles");for(const r of X){const u=F[r],y=at[r];l.append("text").attr("class","cynefinSubtitle").attr("x",u.cx).attr("y",u.cy-10).attr("text-anchor","middle").attr("dominant-baseline","middle").text(y.model),l.append("text").attr("class","cynefinSubtitle").attr("x",u.cx).attr("y",u.cy+5).attr("text-anchor","middle").attr("dominant-baseline","middle").text(y.practice)}l.append("text").attr("class","cynefinSubtitle").attr("x",s/2).attr("y",f/2+8).attr("text-anchor","middle").attr("dominant-baseline","middle").text(at.confusion.practice)}const K=k.append("g").attr("class","cynefin-items"),A=26,tt=10,ut=["complex","complicated","chaotic","clear","confusion"];for(const l of ut){const r=m.get(l);if(!r||r.items.length===0)continue;const u=F[l],y=l==="confusion";let L=r.items,_=0;y&&r.items.length>q&&(_=r.items.length-q,L=r.items.slice(0,q));let B;if(y){const x=g?22:14;B=u.cy+x}else B=u.cy+(g?25:15);if([...L].forEach((x,S)=>{const w=B+S*(A+4),I=K.append("g"),z=I.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",A/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(x.label);let b=x.label.length*7;const h=z.node();if(h&&typeof h.getBBox=="function"){const G=h.getBBox();G.width>0&&(b=G.width)}const C=b+tt*2,E=u.cx-C/2;I.attr("transform",`translate(${E}, ${w})`),I.insert("rect","text").attr("class","cynefinItem").attr("x",0).attr("y",0).attr("width",C).attr("height",A).attr("rx",4).attr("ry",4).attr("fill",M[l]).attr("fill-opacity",.95),z.attr("x",C/2).attr("y",A/2)}),_>0){const x=B+L.length*(A+4),S=`+${_} more`,w=K.append("g"),I=w.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",A/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(S);let z=S.length*7;const b=I.node();if(b&&typeof b.getBBox=="function"){const E=b.getBBox();E.width>0&&(z=E.width)}const h=z+tt*2,C=u.cx-h/2;w.attr("transform",`translate(${C}, ${x})`),w.insert("rect","text").attr("class","cynefinItemOverflow").attr("x",0).attr("y",0).attr("width",h).attr("height",A).attr("rx",4).attr("ry",4).attr("fill",M[l]).attr("fill-opacity",.6),I.attr("x",h/2).attr("y",A/2)}}if(D.length>0){const l=T.select("defs").empty()?T.append("defs"):T.select("defs"),r=`cynefin-arrow-${e}`;l.append("marker").attr("id",r).attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto-start-reverse").append("path").attr("d","M 0 0 L 10 5 L 0 10 z").attr("class","cynefinArrowHead");const u=k.append("g").attr("class","cynefin-arrows");D.forEach(y=>{const L=F[y.from],_=F[y.to];if(!L||!_)return;if(y.from===y.to){O.warn(`Cynefin renderer: skipping self-loop on domain "${y.from}"`);return}const B=L.cx,x=L.cy,S=_.cx,w=_.cy,I=(B+S)/2,z=(x+w)/2,b=S-B,h=w-x,C=Math.sqrt(b*b+h*h),E=C*.15,G=-h/C,gt=b/C,et=I+G*E,nt=z+gt*E;u.append("path").attr("class","cynefinArrowLine").attr("d",`M${B},${x} Q${et},${nt} ${S},${w}`).attr("fill","none").attr("marker-end",`url(#${r})`),y.label&&u.append("text").attr("class","cynefinArrowLabel").attr("x",et).attr("y",nt-6).attr("text-anchor","middle").attr("dominant-baseline","auto").text(y.label)})}N&&k.append("text").attr("class","cynefinTitle").attr("x",s/2).attr("y",-$/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text(N)},"draw"),Ft={draw:Wt},Ht=i(()=>{const t=ot(),e=Q();return U(t,e.themeVariables).cynefin},"getCynefinTheme"),Vt=i(()=>{const t=Ht();return`
	.cynefinDomain {
		stroke: none;
	}
	.cynefinDomainLabel {
		font-size: ${t.domainFontSize}px;
		font-weight: bold;
		fill: ${t.labelColor};
	}
	.cynefinSubtitle {
		font-size: ${t.itemFontSize-1}px;
		fill: ${t.textColor};
		font-style: italic;
	}
	.cynefinItem {
		fill-opacity: 0.95;
		stroke: ${t.boundaryColor};
		stroke-width: 1;
	}
	.cynefinItemText {
		font-size: ${t.itemFontSize}px;
		fill: ${t.textColor};
	}
	.cynefinItemOverflow {
		fill-opacity: 0.6;
		stroke: ${t.boundaryColor};
		stroke-width: 1;
		stroke-dasharray: 3 2;
	}
	.cynefinBoundary {
		stroke: ${t.boundaryColor};
		stroke-width: ${t.boundaryWidth};
		stroke-dasharray: 6 3;
	}
	.cynefinCliff {
		stroke: ${t.cliffColor};
		stroke-width: ${t.cliffWidth};
	}
	.cynefinConfusion {
		stroke: ${t.boundaryColor};
		stroke-width: 1.5;
		stroke-dasharray: 4 2;
	}
	.cynefinArrowLine {
		stroke: ${t.arrowColor};
		stroke-width: ${t.arrowWidth};
		fill: none;
	}
	.cynefinArrowHead {
		fill: ${t.arrowColor};
		stroke: none;
	}
	.cynefinArrowLabel {
		font-size: ${t.itemFontSize-1}px;
		fill: ${t.textColor};
	}
	.cynefinTitle {
		font-size: ${t.domainFontSize+2}px;
		font-weight: bold;
		fill: ${t.labelColor};
	}
	`},"styles"),Gt=Vt,te={parser:Nt,db:Y,renderer:Ft,styles:Gt};export{te as diagram};
//# sourceMappingURL=cynefinDiagram-5FMLGOSQ-BExrwikY.js.map
