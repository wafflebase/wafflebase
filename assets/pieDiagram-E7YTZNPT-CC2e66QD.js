import{p as rt}from"./chunk-JWPE2WC7-CCW6OOmX.js";import{g as nt,s as it,a as ot,b as st,q as lt,p as ct,_ as g,l as P,c as dt,D as ut,G as gt,O as ft,d as pt,r as ht,E as mt}from"./mermaid.core-DVVtAnWq.js";import{p as vt}from"./cynefin-OW5HDTMX-CQqwZaxW.js";import{d as Z}from"./arc-Dy0K1GzA.js";import{o as yt}from"./ordinal-BjExbHwH.js";import{f as $,t as H,n as bt}from"./string-Bbh5eKwb.js";import"./vendor-app-DU5We-AV.js";import"./vendor-react-C3v5QauN.js";import"./purify.es-Diy6E0xa.js";import"./init-BzYQHSO6.js";(function(){try{var t=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};t.SENTRY_RELEASE={id:"0.6.14"};var r=new t.Error().stack;r&&(t._sentryDebugIds=t._sentryDebugIds||{},t._sentryDebugIds[r]="6c30bd15-1397-4c5a-bdbc-3da23b0bbc5f",t._sentryDebugIdIdentifier="sentry-dbid-6c30bd15-1397-4c5a-bdbc-3da23b0bbc5f")}catch{}})();function wt(t,r){return r<t?-1:r>t?1:r>=t?0:NaN}function St(t){return t}function xt(){var t=St,r=wt,p=null,T=$(0),l=$(H),f=$(0);function i(e){var n,s=(e=bt(e)).length,h,S,D=0,m=new Array(s),o=new Array(s),C=+T.apply(this,arguments),_=Math.min(H,Math.max(-H,l.apply(this,arguments)-C)),k,R=Math.min(Math.abs(_)/s,f.apply(this,arguments)),d=R*(_<0?-1:1),x;for(n=0;n<s;++n)(x=o[m[n]=n]=+t(e[n],n,e))>0&&(D+=x);for(r!=null?m.sort(function(z,v){return r(o[z],o[v])}):p!=null&&m.sort(function(z,v){return p(e[z],e[v])}),n=0,S=D?(_-s*d)/D:0;n<s;++n,C=k)h=m[n],x=o[h],k=C+(x>0?x*S:0)+d,o[h]={data:e[h],index:n,value:x,startAngle:C,endAngle:k,padAngle:R};return o}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:$(+e),i):t},i.sortValues=function(e){return arguments.length?(r=e,p=null,i):r},i.sort=function(e){return arguments.length?(p=e,r=null,i):p},i.startAngle=function(e){return arguments.length?(T=typeof e=="function"?e:$(+e),i):T},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:$(+e),i):l},i.padAngle=function(e){return arguments.length?(f=typeof e=="function"?e:$(+e),i):f},i}var At=mt.pie,B={sections:new Map,showData:!1},N=B.sections,V=B.showData,Dt=structuredClone(At),Ct=g(()=>structuredClone(Dt),"getConfig"),$t=g(()=>{N=new Map,V=B.showData,ht()},"clear"),Tt=g(({label:t,value:r})=>{if(r<0)throw new Error(`"${t}" has invalid value: ${r}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);N.has(t)||(N.set(t,r),P.debug(`added new section: ${t}, with value: ${r}`))},"addSection"),kt=g(()=>N,"getSections"),Et=g(t=>{V=t},"setShowData"),_t=g(()=>V,"getShowData"),J={getConfig:Ct,clear:$t,setDiagramTitle:ct,getDiagramTitle:lt,setAccTitle:st,getAccTitle:ot,setAccDescription:it,getAccDescription:nt,addSection:Tt,getSections:kt,setShowData:Et,getShowData:_t},zt=g((t,r)=>{rt(t,r),r.setShowData(t.showData),t.sections.map(r.addSection)},"populateDb"),Mt={parse:g(async t=>{const r=await vt("pie",t);P.debug(r),zt(r,J)},"parse")},Rt=g(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),It=Rt,Lt=g(t=>{const r=[...t.values()].reduce((l,f)=>l+f,0),p=[...t.entries()].map(([l,f])=>({label:l,value:f})).filter(l=>l.value/r*100>=1);return xt().value(l=>l.value).sort(null)(p)},"createPieArcs"),Nt=g((t,r,p,T)=>{var Y;P.debug(`rendering pie chart
`+t);const l=T.db,f=dt(),i=ut(l.getConfig(),f.pie),e=40,n=18,s=4,h=450,S=h,D=gt(r),m=D.append("g");m.attr("transform","translate("+S/2+","+h/2+")");const{themeVariables:o}=f;let[C]=ft(o.pieOuterStrokeWidth);C??(C=2);const _=i.legendPosition,k=i.textPosition,R=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,d=Math.min(S,h)/2-e,x=Z().innerRadius(R*d).outerRadius(d),z=Z().innerRadius(d*k).outerRadius(d*k),v=m.append("g");v.append("circle").attr("cx",0).attr("cy",0).attr("r",d+C/2).attr("class","pieOuterCircle");const I=l.getSections(),K=Lt(I),Q=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12];let O=0;I.forEach(a=>{O+=a});const U=K.filter(a=>(a.data.value/O*100).toFixed(0)!=="0"),W=yt(Q).domain([...I.keys()]);v.selectAll("mySlices").data(U).enter().append("path").attr("d",x).attr("fill",a=>W(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),v.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/O*100).toFixed(0)+"%").attr("transform",a=>"translate("+z.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const tt=m.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),M=[...I.entries()].map(([a,c])=>({label:a,value:c})),A=m.selectAll(".legend").data(M).enter().append("g").attr("class","legend");A.append("rect").attr("width",n).attr("height",n).style("fill",a=>W(a.label)).style("stroke",a=>W(a.label)),A.append("text").attr("x",n+s).attr("y",n-s).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const E=Math.max(...A.selectAll("text").nodes().map(a=>(a==null?void 0:a.getBoundingClientRect().width)??0));let L=h,F=S+e;const u=n+s,G=M.length*u;switch(_){case"center":A.attr("transform",(a,c)=>{const y=u*M.length/2,b=-E/2-(n+s),w=c*u-y;return"translate("+b+","+w+")"});break;case"top":L+=G,A.attr("transform",(a,c)=>{const y=d,b=-E/2-(n+s),w=c*u-y;return`translate(${b}, ${w})`}),v.attr("transform",()=>`translate(0, ${G+u})`);break;case"bottom":L+=G,A.attr("transform",(a,c)=>{const y=-d-u,b=-E/2-(n+s),w=c*u-y;return"translate("+b+","+w+")"});break;case"left":F+=n+s+E,A.attr("transform",(a,c)=>{const y=u*M.length/2,b=-d-(n+s),w=c*u-y;return"translate("+b+","+w+")"}),v.attr("transform",()=>`translate(${E+n+s}, 0)`);break;case"right":default:F+=n+s+E,A.attr("transform",(a,c)=>{const y=u*M.length/2,b=12*n,w=c*u-y;return"translate("+b+","+w+")"});break}const j=((Y=tt.node())==null?void 0:Y.getBoundingClientRect().width)??0,et=S/2-j/2,at=S/2+j/2,q=Math.min(0,et),X=Math.max(F,at)-q;D.attr("viewBox",`${q} 0 ${X} ${L}`),pt(D,L,X,i.useMaxWidth)},"draw"),Ot={draw:Nt},Yt={parser:Mt,db:J,renderer:Ot,styles:It};export{Yt as diagram};
