import{p as k}from"./chunk-JWPE2WC7-MTzHghGH.js";import{s as R,g as F,p as I,o as _,a as D,b as E,_ as c,F as z,q as G,B as y,z as C,D as P,l as B,G as W,e as V}from"./mermaid.core-Q5GWGMzY.js";import{p as H}from"./cynefin-VYW2F7L2-DIFXER_G.js";import"./index-z8eyjqg2.js";import"./vendor-react-dnbZdPVU.js";import"./vendor-app-1Jr3BAAf.js";import"./vendor-ui-CFBp-sJ7.js";import"./vendor-yorkie-DkgtVNCw.js";import"./sheet-core-W_GOYN7B.js";import"./sheet-formula-eval-B26z15Vf.js";import"./sheet-formula-parser-Dq8CaDfp.js";import"./purify.es-Jn2rvFN8.js";import"./string-D05Vy0wW.js";var x={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},w={axes:[],curves:[],options:x},g=structuredClone(w),j=P.radar,q=c(()=>y({...j,...C().radar}),"getConfig"),b=c(()=>g.axes,"getAxes"),N=c(()=>g.curves,"getCurves"),U=c(()=>g.options,"getOptions"),X=c(a=>{g.axes=a.map(t=>({name:t.name,label:t.label??t.name}))},"setAxes"),Y=c(a=>{g.curves=a.map(t=>({name:t.name,label:t.label??t.name,entries:Z(t.entries)}))},"setCurves"),Z=c(a=>{if(a[0].axis==null)return a.map(e=>e.value);const t=b();if(t.length===0)throw new Error("Axes must be populated before curves for reference entries");return t.map(e=>{const r=a.find(s=>{var n;return((n=s.axis)==null?void 0:n.$refText)===e.name});if(r===void 0)throw new Error("Missing entry for axis "+e.label);return r.value})},"computeCurveEntries"),J=c(a=>{var e,r,s,n,l;const t=a.reduce((o,i)=>(o[i.name]=i,o),{});g.options={showLegend:((e=t.showLegend)==null?void 0:e.value)??x.showLegend,ticks:((r=t.ticks)==null?void 0:r.value)??x.ticks,max:((s=t.max)==null?void 0:s.value)??x.max,min:((n=t.min)==null?void 0:n.value)??x.min,graticule:((l=t.graticule)==null?void 0:l.value)??x.graticule}},"setOptions"),K=c(()=>{G(),g=structuredClone(w)},"clear"),$={getAxes:b,getCurves:N,getOptions:U,setAxes:X,setCurves:Y,setOptions:J,getConfig:q,clear:K,setAccTitle:E,getAccTitle:D,setDiagramTitle:_,getDiagramTitle:I,getAccDescription:F,setAccDescription:R},Q=c(a=>{k(a,$);const{axes:t,curves:e,options:r}=a;$.setAxes(t),$.setCurves(e),$.setOptions(r)},"populate"),tt={parse:c(async a=>{const t=await H("radar",a);B.debug(t),Q(t)},"parse")},et=c((a,t,e,r)=>{const s=r.db,n=s.getAxes(),l=s.getCurves(),o=s.getOptions(),i=s.getConfig(),d=s.getDiagramTitle(),u=z(t),p=at(u,i),m=o.max??Math.max(...l.map(f=>Math.max(...f.entries))),h=o.min,v=Math.min(i.width,i.height)/2;rt(p,n,v,o.ticks,o.graticule),st(p,n,v,i),A(p,n,l,h,m,o.graticule,i),T(p,l,o.showLegend,i),p.append("text").attr("class","radarTitle").text(d).attr("x",0).attr("y",-i.height/2-i.marginTop)},"draw"),at=c((a,t)=>{const e=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,s={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return V(a,r,e,t.useMaxWidth??!0),a.attr("viewBox",`0 0 ${e} ${r}`).attr("overflow","visible"),a.append("g").attr("transform",`translate(${s.x}, ${s.y})`)},"drawFrame"),rt=c((a,t,e,r,s)=>{if(s==="circle")for(let n=0;n<r;n++){const l=e*(n+1)/r;a.append("circle").attr("r",l).attr("class","radarGraticule")}else if(s==="polygon"){const n=t.length;for(let l=0;l<r;l++){const o=e*(l+1)/r,i=t.map((d,u)=>{const p=2*u*Math.PI/n-Math.PI/2,m=o*Math.cos(p),h=o*Math.sin(p);return`${m},${h}`}).join(" ");a.append("polygon").attr("points",i).attr("class","radarGraticule")}}},"drawGraticule"),st=c((a,t,e,r)=>{const s=t.length;for(let n=0;n<s;n++){const l=t[n].label,o=2*n*Math.PI/s-Math.PI/2,i=Math.cos(o),d=Math.sin(o);a.append("line").attr("x1",0).attr("y1",0).attr("x2",e*r.axisScaleFactor*i).attr("y2",e*r.axisScaleFactor*d).attr("class","radarAxisLine");const u=i>.01?"start":i<-.01?"end":"middle",p=d>.01?"hanging":d<-.01?"auto":"central",m=4;a.append("text").text(l).attr("x",e*r.axisLabelFactor*i+m*i).attr("y",e*r.axisLabelFactor*d+m*d).attr("text-anchor",u).attr("dominant-baseline",p).attr("class","radarAxisLabel")}},"drawAxes");function A(a,t,e,r,s,n,l){const o=t.length,i=Math.min(l.width,l.height)/2;e.forEach((d,u)=>{if(d.entries.length!==o)return;const p=d.entries.map((m,h)=>{const v=2*Math.PI*h/o-Math.PI/2,f=M(m,r,s,i),S=f*Math.cos(v),O=f*Math.sin(v);return{x:S,y:O}});n==="circle"?a.append("path").attr("d",L(p,l.curveTension)).attr("class",`radarCurve-${u}`):n==="polygon"&&a.append("polygon").attr("points",p.map(m=>`${m.x},${m.y}`).join(" ")).attr("class",`radarCurve-${u}`)})}c(A,"drawCurves");function M(a,t,e,r){const s=Math.min(Math.max(a,t),e);return r*(s-t)/(e-t)}c(M,"relativeRadius");function L(a,t){const e=a.length;let r=`M${a[0].x},${a[0].y}`;for(let s=0;s<e;s++){const n=a[(s-1+e)%e],l=a[s],o=a[(s+1)%e],i=a[(s+2)%e],d={x:l.x+(o.x-n.x)*t,y:l.y+(o.y-n.y)*t},u={x:o.x-(i.x-l.x)*t,y:o.y-(i.y-l.y)*t};r+=` C${d.x},${d.y} ${u.x},${u.y} ${o.x},${o.y}`}return`${r} Z`}c(L,"closedRoundCurve");function T(a,t,e,r){if(!e)return;const s=(r.width/2+r.marginRight)*3/4,n=-(r.height/2+r.marginTop)*3/4,l=20;t.forEach((o,i)=>{const d=a.append("g").attr("transform",`translate(${s}, ${n+i*l})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${i}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(o.label)})}c(T,"drawLegend");var nt={draw:et},ot=c((a,t)=>{let e="";for(let r=0;r<a.THEME_COLOR_LIMIT;r++){const s=a[`cScale${r}`];e+=`
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
		`}return e},"genIndexStyles"),it=c(a=>{const t=W(),e=C(),r=y(t,e.themeVariables),s=y(r.radar,a);return{themeVariables:r,radarOptions:s}},"buildRadarStyleOptions"),lt=c(({radar:a}={})=>{const{themeVariables:t,radarOptions:e}=it(a);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${e.axisColor};
		stroke-width: ${e.axisStrokeWidth};
	}
	.radarAxisLabel {
		font-size: ${e.axisLabelFontSize}px;
		color: ${e.axisColor};
	}
	.radarGraticule {
		fill: ${e.graticuleColor};
		fill-opacity: ${e.graticuleOpacity};
		stroke: ${e.graticuleColor};
		stroke-width: ${e.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${e.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${ot(t,e)}
	`},"styles"),wt={parser:tt,db:$,renderer:nt,styles:lt};export{wt as diagram};
