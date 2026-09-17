import{p as rt}from"./chunk-JWPE2WC7-prYwqtTw.js";import{g as nt,s as it,a as ot,b as st,q as lt,p as ct,_ as g,l as P,c as dt,D as ut,G as gt,O as pt,d as ft,r as ht,E as mt}from"./mermaid.core-DTy5nHxS.js";import{p as vt}from"./cynefin-OW5HDTMX-C9e86QcR.js";import{d as Z}from"./arc-Baz4Ub11.js";import{o as yt}from"./ordinal-Br6gDx7X.js";import{f as $,t as H,n as wt}from"./string-Binoq9JV.js";import"./slides-editor-engine-DPxKP7x5.js";import"./sheet-core-Cjhq9Mse.js";import"./sheet-formula-eval-BR9GaFP9.js";import"./sheet-formula-parser-BdsBYEJT.js";import"./vendor-react-T2gKtWM2.js";import"./purify.es-2s3YrXI7.js";import"./init-CRWyuVBL.js";(function(){try{var t=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};t.SENTRY_RELEASE={id:"0.6.11"};var r=new t.Error().stack;r&&(t._sentryDebugIds=t._sentryDebugIds||{},t._sentryDebugIds[r]="d39c829b-d856-46f5-b429-094294aa9394",t._sentryDebugIdIdentifier="sentry-dbid-d39c829b-d856-46f5-b429-094294aa9394")}catch{}})();function St(t,r){return r<t?-1:r>t?1:r>=t?0:NaN}function xt(t){return t}function bt(){var t=xt,r=St,f=null,T=$(0),l=$(H),p=$(0);function i(e){var n,s=(e=wt(e)).length,h,x,D=0,m=new Array(s),o=new Array(s),C=+T.apply(this,arguments),_=Math.min(H,Math.max(-H,l.apply(this,arguments)-C)),k,R=Math.min(Math.abs(_)/s,p.apply(this,arguments)),d=R*(_<0?-1:1),b;for(n=0;n<s;++n)(b=o[m[n]=n]=+t(e[n],n,e))>0&&(D+=b);for(r!=null?m.sort(function(z,v){return r(o[z],o[v])}):f!=null&&m.sort(function(z,v){return f(e[z],e[v])}),n=0,x=D?(_-s*d)/D:0;n<s;++n,C=k)h=m[n],b=o[h],k=C+(b>0?b*x:0)+d,o[h]={data:e[h],index:n,value:b,startAngle:C,endAngle:k,padAngle:R};return o}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:$(+e),i):t},i.sortValues=function(e){return arguments.length?(r=e,f=null,i):r},i.sort=function(e){return arguments.length?(f=e,r=null,i):f},i.startAngle=function(e){return arguments.length?(T=typeof e=="function"?e:$(+e),i):T},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:$(+e),i):l},i.padAngle=function(e){return arguments.length?(p=typeof e=="function"?e:$(+e),i):p},i}var At=mt.pie,B={sections:new Map,showData:!1},N=B.sections,V=B.showData,Dt=structuredClone(At),Ct=g(()=>structuredClone(Dt),"getConfig"),$t=g(()=>{N=new Map,V=B.showData,ht()},"clear"),Tt=g(({label:t,value:r})=>{if(r<0)throw new Error(`"${t}" has invalid value: ${r}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);N.has(t)||(N.set(t,r),P.debug(`added new section: ${t}, with value: ${r}`))},"addSection"),kt=g(()=>N,"getSections"),Et=g(t=>{V=t},"setShowData"),_t=g(()=>V,"getShowData"),J={getConfig:Ct,clear:$t,setDiagramTitle:ct,getDiagramTitle:lt,setAccTitle:st,getAccTitle:ot,setAccDescription:it,getAccDescription:nt,addSection:Tt,getSections:kt,setShowData:Et,getShowData:_t},zt=g((t,r)=>{rt(t,r),r.setShowData(t.showData),t.sections.map(r.addSection)},"populateDb"),Mt={parse:g(async t=>{const r=await vt("pie",t);P.debug(r),zt(r,J)},"parse")},Rt=g(t=>`
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
`,"getStyles"),It=Rt,Lt=g(t=>{const r=[...t.values()].reduce((l,p)=>l+p,0),f=[...t.entries()].map(([l,p])=>({label:l,value:p})).filter(l=>l.value/r*100>=1);return bt().value(l=>l.value).sort(null)(f)},"createPieArcs"),Nt=g((t,r,f,T)=>{var Y;P.debug(`rendering pie chart
`+t);const l=T.db,p=dt(),i=ut(l.getConfig(),p.pie),e=40,n=18,s=4,h=450,x=h,D=gt(r),m=D.append("g");m.attr("transform","translate("+x/2+","+h/2+")");const{themeVariables:o}=p;let[C]=pt(o.pieOuterStrokeWidth);C??(C=2);const _=i.legendPosition,k=i.textPosition,R=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,d=Math.min(x,h)/2-e,b=Z().innerRadius(R*d).outerRadius(d),z=Z().innerRadius(d*k).outerRadius(d*k),v=m.append("g");v.append("circle").attr("cx",0).attr("cy",0).attr("r",d+C/2).attr("class","pieOuterCircle");const I=l.getSections(),K=Lt(I),Q=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12];let O=0;I.forEach(a=>{O+=a});const U=K.filter(a=>(a.data.value/O*100).toFixed(0)!=="0"),W=yt(Q).domain([...I.keys()]);v.selectAll("mySlices").data(U).enter().append("path").attr("d",b).attr("fill",a=>W(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),v.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/O*100).toFixed(0)+"%").attr("transform",a=>"translate("+z.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const tt=m.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),M=[...I.entries()].map(([a,c])=>({label:a,value:c})),A=m.selectAll(".legend").data(M).enter().append("g").attr("class","legend");A.append("rect").attr("width",n).attr("height",n).style("fill",a=>W(a.label)).style("stroke",a=>W(a.label)),A.append("text").attr("x",n+s).attr("y",n-s).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const E=Math.max(...A.selectAll("text").nodes().map(a=>(a==null?void 0:a.getBoundingClientRect().width)??0));let L=h,F=x+e;const u=n+s,G=M.length*u;switch(_){case"center":A.attr("transform",(a,c)=>{const y=u*M.length/2,w=-E/2-(n+s),S=c*u-y;return"translate("+w+","+S+")"});break;case"top":L+=G,A.attr("transform",(a,c)=>{const y=d,w=-E/2-(n+s),S=c*u-y;return`translate(${w}, ${S})`}),v.attr("transform",()=>`translate(0, ${G+u})`);break;case"bottom":L+=G,A.attr("transform",(a,c)=>{const y=-d-u,w=-E/2-(n+s),S=c*u-y;return"translate("+w+","+S+")"});break;case"left":F+=n+s+E,A.attr("transform",(a,c)=>{const y=u*M.length/2,w=-d-(n+s),S=c*u-y;return"translate("+w+","+S+")"}),v.attr("transform",()=>`translate(${E+n+s}, 0)`);break;case"right":default:F+=n+s+E,A.attr("transform",(a,c)=>{const y=u*M.length/2,w=12*n,S=c*u-y;return"translate("+w+","+S+")"});break}const j=((Y=tt.node())==null?void 0:Y.getBoundingClientRect().width)??0,et=x/2-j/2,at=x/2+j/2,q=Math.min(0,et),X=Math.max(F,at)-q;D.attr("viewBox",`${q} 0 ${X} ${L}`),ft(D,L,X,i.useMaxWidth)},"draw"),Ot={draw:Nt},Kt={parser:Mt,db:J,renderer:Ot,styles:It};export{Kt as diagram};
//# sourceMappingURL=pieDiagram-E7YTZNPT-DyzKXjOh.js.map
