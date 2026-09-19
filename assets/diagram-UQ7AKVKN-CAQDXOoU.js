import{p as E}from"./chunk-JWPE2WC7-CdB404yH.js";import{s as O,g as R,q as D,p as F,a as G,b as P,_ as c,G as z,r as B,D as b,A as w,E as W,l as C,H,d as V}from"./mermaid.core-BpiYqNY4.js";import{p as j}from"./cynefin-OW5HDTMX-C-_XazLL.js";import"./slides-editor-engine-ChMcY0cZ.js";import"./sheet-core-CmSM58JS.js";import"./sheet-formula-eval-BNq4TmCx.js";import"./sheet-formula-parser-D0I0zm21.js";import"./vendor-react-B90fPc98.js";import"./purify.es-Du9o_Ba4.js";import"./string-DJXsATgL.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.12"};var t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]="d4ac5672-56d2-4f36-927f-604d97b74951",e._sentryDebugIdIdentifier="sentry-dbid-d4ac5672-56d2-4f36-927f-604d97b74951")}catch{}})();var x={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},$=32,A={axes:[],curves:[],options:x},m=structuredClone(A),N=W.radar,U=c(()=>b({...N,...w().radar}),"getConfig"),M=c(()=>m.axes,"getAxes"),X=c(()=>m.curves,"getCurves"),Y=c(()=>m.options,"getOptions"),q=c(e=>{m.axes=e.map(t=>({name:t.name,label:t.label??t.name}))},"setAxes"),K=c(e=>{m.curves=e.map(t=>({name:t.name,label:t.label??t.name,entries:Z(t.entries)}))},"setCurves"),Z=c(e=>{if(e[0].axis==null)return e.map(a=>a.value);const t=M();if(t.length===0)throw new Error("Axes must be populated before curves for reference entries");return t.map(a=>{const r=e.find(s=>{var n;return((n=s.axis)==null?void 0:n.$refText)===a.name});if(r===void 0)throw new Error("Missing entry for axis "+a.label);return r.value})},"computeCurveEntries"),J=c(e=>{var a,r,s,n,l;const t=e.reduce((o,i)=>(o[i.name]=i,o),{});m.options={showLegend:((a=t.showLegend)==null?void 0:a.value)??x.showLegend,ticks:((r=t.ticks)==null?void 0:r.value)??x.ticks,max:((s=t.max)==null?void 0:s.value)??x.max,min:((n=t.min)==null?void 0:n.value)??x.min,graticule:((l=t.graticule)==null?void 0:l.value)??x.graticule},m.options.ticks>$&&(C.warn(`Radar diagram ticks (${m.options.ticks}) exceeds maximum allowed (${$}). Using ${$} instead.`),m.options.ticks=$)},"setOptions"),Q=c(()=>{B(),m=structuredClone(A)},"clear"),f={getAxes:M,getCurves:X,getOptions:Y,setAxes:q,setCurves:K,setOptions:J,getConfig:U,clear:Q,setAccTitle:P,getAccTitle:G,setDiagramTitle:F,getDiagramTitle:D,getAccDescription:R,setAccDescription:O},tt=c(e=>{E(e,f);const{axes:t,curves:a,options:r}=e;f.setAxes(t),f.setCurves(a),f.setOptions(r)},"populate"),et={parse:c(async e=>{const t=await j("radar",e);C.debug(t),tt(t)},"parse")},at=c((e,t,a,r)=>{const s=r.db,n=s.getAxes(),l=s.getCurves(),o=s.getOptions(),i=s.getConfig(),d=s.getDiagramTitle(),p=z(t),u=rt(p,i),g=o.max??Math.max(...l.map(y=>Math.max(...y.entries))),h=o.min,v=Math.min(i.width,i.height)/2;st(u,n,v,o.ticks,o.graticule),nt(u,n,v,i),L(u,n,l,h,g,o.graticule,i),k(u,l,o.showLegend,i),u.append("text").attr("class","radarTitle").text(d).attr("x",0).attr("y",-i.height/2-i.marginTop)},"draw"),rt=c((e,t)=>{const a=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,s={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return V(e,r,a,t.useMaxWidth??!0),e.attr("viewBox",`0 0 ${a} ${r}`).attr("overflow","visible"),e.append("g").attr("transform",`translate(${s.x}, ${s.y})`)},"drawFrame"),st=c((e,t,a,r,s)=>{if(s==="circle")for(let n=0;n<r;n++){const l=a*(n+1)/r;e.append("circle").attr("r",l).attr("class","radarGraticule")}else if(s==="polygon"){const n=t.length;for(let l=0;l<r;l++){const o=a*(l+1)/r,i=t.map((d,p)=>{const u=2*p*Math.PI/n-Math.PI/2,g=o*Math.cos(u),h=o*Math.sin(u);return`${g},${h}`}).join(" ");e.append("polygon").attr("points",i).attr("class","radarGraticule")}}},"drawGraticule"),nt=c((e,t,a,r)=>{const s=t.length;for(let n=0;n<s;n++){const l=t[n].label,o=2*n*Math.PI/s-Math.PI/2,i=Math.cos(o),d=Math.sin(o);e.append("line").attr("x1",0).attr("y1",0).attr("x2",a*r.axisScaleFactor*i).attr("y2",a*r.axisScaleFactor*d).attr("class","radarAxisLine");const p=i>.01?"start":i<-.01?"end":"middle",u=d>.01?"hanging":d<-.01?"auto":"central",g=4;e.append("text").text(l).attr("x",a*r.axisLabelFactor*i+g*i).attr("y",a*r.axisLabelFactor*d+g*d).attr("text-anchor",p).attr("dominant-baseline",u).attr("class","radarAxisLabel")}},"drawAxes");function L(e,t,a,r,s,n,l){const o=t.length,i=Math.min(l.width,l.height)/2;a.forEach((d,p)=>{if(d.entries.length!==o)return;const u=d.entries.map((g,h)=>{const v=2*Math.PI*h/o-Math.PI/2,y=T(g,r,s,i),I=y*Math.cos(v),_=y*Math.sin(v);return{x:I,y:_}});n==="circle"?e.append("path").attr("d",S(u,l.curveTension)).attr("class",`radarCurve-${p}`):n==="polygon"&&e.append("polygon").attr("points",u.map(g=>`${g.x},${g.y}`).join(" ")).attr("class",`radarCurve-${p}`)})}c(L,"drawCurves");function T(e,t,a,r){const s=Math.min(Math.max(e,t),a);return r*(s-t)/(a-t)}c(T,"relativeRadius");function S(e,t){const a=e.length;let r=`M${e[0].x},${e[0].y}`;for(let s=0;s<a;s++){const n=e[(s-1+a)%a],l=e[s],o=e[(s+1)%a],i=e[(s+2)%a],d={x:l.x+(o.x-n.x)*t,y:l.y+(o.y-n.y)*t},p={x:o.x-(i.x-l.x)*t,y:o.y-(i.y-l.y)*t};r+=` C${d.x},${d.y} ${p.x},${p.y} ${o.x},${o.y}`}return`${r} Z`}c(S,"closedRoundCurve");function k(e,t,a,r){if(!a)return;const s=(r.width/2+r.marginRight)*3/4,n=-(r.height/2+r.marginTop)*3/4,l=20;t.forEach((o,i)=>{const d=e.append("g").attr("transform",`translate(${s}, ${n+i*l})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${i}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(o.label)})}c(k,"drawLegend");var ot={draw:at},it=c((e,t)=>{let a="";for(let r=0;r<e.THEME_COLOR_LIMIT;r++){const s=e[`cScale${r}`];a+=`
		.radarCurve-${r} {
			color: ${s};
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
			stroke-width: ${t.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
		}
		`}return a},"genIndexStyles"),lt=c(e=>{const t=H(),a=w(),r=b(t,a.themeVariables),s=b(r.radar,e);return{themeVariables:r,radarOptions:s}},"buildRadarStyleOptions"),ct=c(({radar:e}={})=>{const{themeVariables:t,radarOptions:a}=lt(e);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${a.axisColor};
		stroke-width: ${a.axisStrokeWidth};
	}
	.radarAxisLabel {
		font-size: ${a.axisLabelFontSize}px;
		color: ${a.axisColor};
	}
	.radarGraticule {
		fill: ${a.graticuleColor};
		fill-opacity: ${a.graticuleOpacity};
		stroke: ${a.graticuleColor};
		stroke-width: ${a.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${a.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${it(t,a)}
	`},"styles"),$t={parser:et,db:f,renderer:ot,styles:ct};export{$t as diagram};
