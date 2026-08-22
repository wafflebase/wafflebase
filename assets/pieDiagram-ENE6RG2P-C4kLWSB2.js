import{p as rt}from"./chunk-JWPE2WC7-CBVHGd3L.js";import{g as nt,s as it,a as ot,b as st,p as lt,o as ct,_ as p,l as G,c as ut,B as gt,F as pt,N as dt,e as ht,q as ft,D as mt}from"./mermaid.core-BhetlMIP.js";import{p as vt}from"./cynefin-VYW2F7L2-2bGOZSc7.js";import{d as J}from"./arc-DGcvFSFp.js";import{o as xt}from"./ordinal-DILIJJjt.js";import{a as T,t as B,n as St}from"./string-D05Vy0wW.js";import"./index-DI04Bgb9.js";import"./vendor-react-dnbZdPVU.js";import"./vendor-app-1Jr3BAAf.js";import"./vendor-ui-DaQRtwX9.js";import"./vendor-yorkie-DkgtVNCw.js";import"./sheet-core-DSrsXWdS.js";import"./sheet-formula-eval-1R5vFTqv.js";import"./sheet-formula-parser-Dq8CaDfp.js";import"./purify.es-Jn2rvFN8.js";import"./init-Dmth1JHB.js";function yt(t,n){return n<t?-1:n>t?1:n>=t?0:NaN}function wt(t){return t}function At(){var t=wt,n=yt,y=null,b=T(0),l=T(B),d=T(0);function i(e){var r,s=(e=St(e)).length,h,w,$=0,f=new Array(s),o=new Array(s),D=+b.apply(this,arguments),E=Math.min(B,Math.max(-B,l.apply(this,arguments)-D)),k,F=Math.min(Math.abs(E)/s,d.apply(this,arguments)),u=F*(E<0?-1:1),A;for(r=0;r<s;++r)(A=o[f[r]=r]=+t(e[r],r,e))>0&&($+=A);for(n!=null?f.sort(function(M,m){return n(o[M],o[m])}):y!=null&&f.sort(function(M,m){return y(e[M],e[m])}),r=0,w=$?(E-s*u)/$:0;r<s;++r,D=k)h=f[r],A=o[h],k=D+(A>0?A*w:0)+u,o[h]={data:e[h],index:r,value:A,startAngle:D,endAngle:k,padAngle:F};return o}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:T(+e),i):t},i.sortValues=function(e){return arguments.length?(n=e,y=null,i):n},i.sort=function(e){return arguments.length?(y=e,n=null,i):y},i.startAngle=function(e){return arguments.length?(b=typeof e=="function"?e:T(+e),i):b},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:T(+e),i):l},i.padAngle=function(e){return arguments.length?(d=typeof e=="function"?e:T(+e),i):d},i}var Ct=mt.pie,I={sections:new Map,showData:!1},W=I.sections,V=I.showData,$t=structuredClone(Ct),Dt=p(()=>structuredClone($t),"getConfig"),Tt=p(()=>{W=new Map,V=I.showData,ft()},"clear"),bt=p(({label:t,value:n})=>{if(n<0)throw new Error(`"${t}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);W.has(t)||(W.set(t,n),G.debug(`added new section: ${t}, with value: ${n}`))},"addSection"),kt=p(()=>W,"getSections"),zt=p(t=>{V=t},"setShowData"),Et=p(()=>V,"getShowData"),K={getConfig:Dt,clear:Tt,setDiagramTitle:ct,getDiagramTitle:lt,setAccTitle:st,getAccTitle:ot,setAccDescription:it,getAccDescription:nt,addSection:bt,getSections:kt,setShowData:zt,getShowData:Et},Mt=p((t,n)=>{rt(t,n),n.setShowData(t.showData),t.sections.map(n.addSection)},"populateDb"),Rt={parse:p(async t=>{const n=await vt("pie",t);G.debug(n),Mt(n,K)},"parse")},Ft=p(t=>`
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
`,"getStyles"),Lt=Ft,Nt=p(t=>{const n=[...t.values()].reduce((l,d)=>l+d,0),y=[...t.entries()].map(([l,d])=>({label:l,value:d})).filter(l=>l.value/n*100>=1);return At().value(l=>l.value).sort(null)(y)},"createPieArcs"),Wt=p((t,n,y,b)=>{var Z;G.debug(`rendering pie chart
`+t);const l=b.db,d=ut(),i=gt(l.getConfig(),d.pie),e=40,r=18,s=4,h=450,w=h,$=pt(n),f=$.append("g");f.attr("transform","translate("+w/2+","+h/2+")");const{themeVariables:o}=d;let[D]=dt(o.pieOuterStrokeWidth);D??(D=2);const E=i.legendPosition,k=i.textPosition,F=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,u=Math.min(w,h)/2-e,A=J().innerRadius(F*u).outerRadius(u),M=J().innerRadius(u*k).outerRadius(u*k),m=f.append("g");m.append("circle").attr("cx",0).attr("cy",0).attr("r",u+D/2).attr("class","pieOuterCircle");const L=l.getSections(),Q=Nt(L),Y=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12];let _=0;L.forEach(a=>{_+=a});const U=Q.filter(a=>(a.data.value/_*100).toFixed(0)!=="0"),H=xt(Y).domain([...L.keys()]);m.selectAll("mySlices").data(U).enter().append("path").attr("d",A).attr("fill",a=>H(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),m.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/_*100).toFixed(0)+"%").attr("transform",a=>"translate("+M.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const tt=f.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),R=[...L.entries()].map(([a,c])=>({label:a,value:c})),C=f.selectAll(".legend").data(R).enter().append("g").attr("class","legend");C.append("rect").attr("width",r).attr("height",r).style("fill",a=>H(a.label)).style("stroke",a=>H(a.label)),C.append("text").attr("x",r+s).attr("y",r-s).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const z=Math.max(...C.selectAll("text").nodes().map(a=>(a==null?void 0:a.getBoundingClientRect().width)??0));let N=h,O=w+e;const g=r+s,P=R.length*g;switch(E){case"center":C.attr("transform",(a,c)=>{const v=g*R.length/2,x=-z/2-(r+s),S=c*g-v;return"translate("+x+","+S+")"});break;case"top":N+=P,C.attr("transform",(a,c)=>{const v=u,x=-z/2-(r+s),S=c*g-v;return`translate(${x}, ${S})`}),m.attr("transform",()=>`translate(0, ${P+g})`);break;case"bottom":N+=P,C.attr("transform",(a,c)=>{const v=-u-g,x=-z/2-(r+s),S=c*g-v;return"translate("+x+","+S+")"});break;case"left":O+=r+s+z,C.attr("transform",(a,c)=>{const v=g*R.length/2,x=-u-(r+s),S=c*g-v;return"translate("+x+","+S+")"}),m.attr("transform",()=>`translate(${z+r+s}, 0)`);break;case"right":default:O+=r+s+z,C.attr("transform",(a,c)=>{const v=g*R.length/2,x=12*r,S=c*g-v;return"translate("+x+","+S+")"});break}const j=((Z=tt.node())==null?void 0:Z.getBoundingClientRect().width)??0,et=w/2-j/2,at=w/2+j/2,q=Math.min(0,et),X=Math.max(O,at)-q;$.attr("viewBox",`${q} 0 ${X} ${N}`),ht($,N,X,i.useMaxWidth)},"draw"),_t={draw:Wt},ee={parser:Rt,db:K,renderer:_t,styles:Lt};export{ee as diagram};
