import{_ as p,l as k,G as X,A as B,r as G,H as q,d as U,i as j,c as K}from"./mermaid.core-DlRoUGG_.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"0.6.12"};var r=new e.Error().stack;r&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[r]="f6d38858-187c-4471-a5a9-8118955c4a59",e._sentryDebugIdIdentifier="sentry-dbid-f6d38858-187c-4471-a5a9-8118955c4a59")}catch{}})();var A="",M="",D="",E=[],b=new Map,C=p(e=>j(e,K()),"sanitizeText"),F=p(e=>{switch(e.type){case"terminal":return{...e,value:C(e.value)};case"nonterminal":return{...e,name:C(e.name)};case"sequence":return{...e,elements:e.elements.map(F)};case"choice":return{...e,alternatives:e.alternatives.map(F)};case"optional":return{...e,element:F(e.element)};case"repetition":return{...e,element:F(e.element),separator:e.separator?F(e.separator):void 0};case"special":return{...e,text:C(e.text)}}},"sanitizeAstNode"),J=p(()=>{A="",M="",D="",E.length=0,b.clear(),G(),k.debug("[Railroad] Database cleared")},"clear"),Y=p(e=>{A=C(e),k.debug("[Railroad] Title set:",e)},"setTitle"),I=p(()=>A,"getTitle"),Q=p(e=>{const r={...e,name:C(e.name),definition:F(e.definition),comment:e.comment?C(e.comment):void 0};k.debug("[Railroad] Adding rule:",r.name),b.has(r.name)&&k.warn(`[Railroad] Rule '${r.name}' is already defined. Overwriting.`),E.push(r),b.set(r.name,r)},"addRule"),Z=p(()=>E,"getRules"),V=p(e=>b.get(e),"getRule"),ee=p(e=>{M=C(e).replace(/^\s+/g,""),k.debug("[Railroad] Accessibility title set:",e)},"setAccTitle"),te=p(()=>M,"getAccTitle"),re=p(e=>{D=C(e).replace(/\n\s+/g,`
`),k.debug("[Railroad] Accessibility description set:",e)},"setAccDescription"),ie=p(()=>D,"getAccDescription"),ne=Y,ae=I,oe={clear:J,setTitle:Y,getTitle:I,addRule:Q,getRules:Z,getRule:V,setAccTitle:ee,getAccTitle:te,setAccDescription:re,getAccDescription:ie,setDiagramTitle:ne,getDiagramTitle:ae},f={compactMode:!1,padding:10,verticalSeparation:8,horizontalSeparation:10,arcRadius:10,fontSize:14,fontFamily:"monospace",terminalFill:"#FFFFC0",terminalStroke:"#000000",terminalTextColor:"#000000",nonTerminalFill:"#FFFFFF",nonTerminalStroke:"#000000",nonTerminalTextColor:"#000000",lineColor:"#000000",strokeWidth:2,markerFill:"#000000",commentFill:"#E8E8E8",commentStroke:"#888888",commentTextColor:"#666666",specialFill:"#F0E0FF",specialStroke:"#8800CC",ruleNameColor:"#000066",showMarkers:!0,markerRadius:5},le=/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$|^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([\d\s%+,./-]+\)$|^[a-z]+$/i,se=/^[\w "',.-]+$/,de=new Set(["compactMode","padding","verticalSeparation","horizontalSeparation","arcRadius","fontSize","fontFamily","terminalFill","terminalStroke","terminalTextColor","nonTerminalFill","nonTerminalStroke","nonTerminalTextColor","lineColor","strokeWidth","markerFill","commentFill","commentStroke","commentTextColor","specialFill","specialStroke","ruleNameColor","showMarkers","markerRadius"]),P=p(e=>e?Object.keys(e).every(r=>r==="railroad"||de.has(r)):!1,"isRailroadStyleOptions"),ce=p(e=>e?"railroad"in e&&e.railroad?e.railroad:P(e)?e:{}:{},"extractRailroadOverrides"),me=p(e=>{if(!e||P(e))return{};const{railroad:r,svgId:a,theme:n,look:t,...i}=e;return i},"extractThemeOverrides"),m=p((e,r)=>{if(typeof e!="string")return r;const a=e.trim();return le.test(a)?a:r},"sanitizeColorValue"),L=p((e,r)=>{if(typeof e!="string")return r;const a=e.trim();return se.test(a)?a:r},"sanitizeFontFamilyValue"),y=p((e,r)=>{const a=typeof e=="number"?e:typeof e=="string"?Number.parseFloat(e):Number.NaN;return Number.isFinite(a)&&a>=0?a:r},"sanitizeNumberValue"),he=p(e=>{const r=typeof e=="number"?e:typeof e=="string"?Number.parseFloat(e):Number.NaN;return Number.isFinite(r)&&r>0?r:void 0},"parseThemeFontSize"),pe=p(e=>{const r=L(e.fontFamily,f.fontFamily),a=he(e.fontSize)??f.fontSize;return{...f,fontFamily:r,fontSize:a,terminalFill:m(e.secondBkg??e.secondaryColor,f.terminalFill),terminalStroke:m(e.secondaryBorderColor??e.lineColor,f.terminalStroke),terminalTextColor:m(e.secondaryTextColor??e.textColor,f.terminalTextColor),nonTerminalFill:m(e.mainBkg??e.background,f.nonTerminalFill),nonTerminalStroke:m(e.primaryBorderColor??e.lineColor,f.nonTerminalStroke),nonTerminalTextColor:m(e.primaryTextColor??e.textColor,f.nonTerminalTextColor),lineColor:m(e.lineColor,f.lineColor),markerFill:m(e.lineColor,f.markerFill),commentFill:m(e.labelBackground??e.tertiaryColor,f.commentFill),commentStroke:m(e.tertiaryBorderColor??e.lineColor,f.commentStroke),commentTextColor:m(e.tertiaryTextColor??e.textColor,f.commentTextColor),specialFill:m(e.tertiaryColor??e.secondaryColor,f.specialFill),specialStroke:m(e.tertiaryBorderColor??e.secondaryBorderColor,f.specialStroke),ruleNameColor:m(e.titleColor??e.textColor,f.ruleNameColor)}},"buildThemeDefaults"),O=p(e=>{const r=B(),a={...q(),...r.themeVariables??{},...me(e)},n=pe(a),t={...r.railroad??{},...ce(e)};return{compactMode:t.compactMode??n.compactMode,padding:y(t.padding,n.padding),verticalSeparation:y(t.verticalSeparation,n.verticalSeparation),horizontalSeparation:y(t.horizontalSeparation,n.horizontalSeparation),arcRadius:y(t.arcRadius,n.arcRadius),fontSize:y(t.fontSize,n.fontSize),fontFamily:L(t.fontFamily,n.fontFamily),terminalFill:m(t.terminalFill,n.terminalFill),terminalStroke:m(t.terminalStroke,n.terminalStroke),terminalTextColor:m(t.terminalTextColor,n.terminalTextColor),nonTerminalFill:m(t.nonTerminalFill,n.nonTerminalFill),nonTerminalStroke:m(t.nonTerminalStroke,n.nonTerminalStroke),nonTerminalTextColor:m(t.nonTerminalTextColor,n.nonTerminalTextColor),lineColor:m(t.lineColor,n.lineColor),strokeWidth:y(t.strokeWidth,n.strokeWidth),markerFill:m(t.markerFill,n.markerFill),commentFill:m(t.commentFill,n.commentFill),commentStroke:m(t.commentStroke,n.commentStroke),commentTextColor:m(t.commentTextColor,n.commentTextColor),specialFill:m(t.specialFill,n.specialFill),specialStroke:m(t.specialStroke,n.specialStroke),ruleNameColor:m(t.ruleNameColor,n.ruleNameColor),showMarkers:t.showMarkers??n.showMarkers,markerRadius:y(t.markerRadius,n.markerRadius)}},"buildRailroadStyleOptions"),Te=p(e=>{const{fontFamily:r,fontSize:a,terminalFill:n,terminalStroke:t,terminalTextColor:i,nonTerminalFill:o,nonTerminalStroke:g,nonTerminalTextColor:l,lineColor:s,strokeWidth:h,markerFill:u,commentFill:c,commentStroke:w,commentTextColor:d,specialFill:T,specialStroke:z,ruleNameColor:S}=O(e);return`
  .railroad-diagram {
    font-family: ${r};
    font-size: ${a}px;
  }

  .railroad-terminal rect {
    fill: ${n};
    stroke: ${t};
    stroke-width: ${h}px;
  }

  .railroad-terminal text {
    fill: ${i};
    font-family: ${r};
    font-size: ${a}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-nonterminal rect {
    fill: ${o};
    stroke: ${g};
    stroke-width: ${h}px;
  }

  .railroad-nonterminal text {
    fill: ${l};
    font-family: ${r};
    font-size: ${a}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-line {
    stroke: ${s};
    stroke-width: ${h}px;
    fill: none;
  }

  .railroad-start circle,
  .railroad-end circle {
    fill: ${u};
  }

  .railroad-comment ellipse {
    fill: ${c};
    stroke: ${w};
    stroke-width: ${h}px;
  }

  .railroad-comment text {
    fill: ${d};
    font-style: italic;
    font-family: ${r};
    font-size: ${a}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-special rect {
    fill: ${T};
    stroke: ${z};
    stroke-width: ${h}px;
    stroke-dasharray: 5,3;
  }

  .railroad-special text {
    fill: ${l};
    font-family: ${r};
    font-size: ${a}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-rule-name {
    font-weight: bold;
    fill: ${S};
    font-family: ${r};
    font-size: ${a}px;
  }

  .railroad-group {
    /* Grouping container, no specific styles */
  }
`},"getStyles"),R,x=(R=class{constructor(){this.d=""}moveTo(r,a){return this.d+=`M ${r} ${a} `,this}lineTo(r,a){return this.d+=`L ${r} ${a} `,this}horizontalTo(r){return this.d+=`H ${r} `,this}verticalTo(r){return this.d+=`V ${r} `,this}arcTo(r,a,n,t,i,o,g){return this.d+=`A ${r} ${a} ${n} ${t?1:0} ${i?1:0} ${o} ${g} `,this}build(){return this.d.trim()}},p(R,"PathBuilder"),R),$,ue=($=class{constructor(r,a=O()){this.textCache=new Map,this.svg=r,this.config=a}measureText(r){if(this.textCache.has(r))return this.textCache.get(r);const a=this.svg.append("text").attr("font-family",this.config.fontFamily).attr("font-size",this.config.fontSize).text(r),n=a.node().getBBox(),t={width:n.width,height:n.height};return a.remove(),this.textCache.set(r,t),t}renderTerminal(r,a){const n=this.measureText(a),t=n.width+this.config.padding*2,i=n.height+this.config.padding*2,o=r.append("g").attr("class","railroad-terminal");return o.append("rect").attr("x",0).attr("y",0).attr("width",t).attr("height",i).attr("rx",10).attr("ry",10),o.append("text").attr("x",t/2).attr("y",i/2).text(a),{element:o.node(),dimensions:{width:t,height:i,up:i/2,down:i/2}}}renderNonTerminal(r,a){const n=this.measureText(a),t=n.width+this.config.padding*2,i=n.height+this.config.padding*2,o=r.append("g").attr("class","railroad-nonterminal");return o.append("rect").attr("x",0).attr("y",0).attr("width",t).attr("height",i),o.append("text").attr("x",t/2).attr("y",i/2).text(a),{element:o.node(),dimensions:{width:t,height:i,up:i/2,down:i/2}}}renderSequence(r,a){const n=a.map(s=>this.renderExpression(r,s));let t=0,i=0,o=0;for(const s of n)t+=s.dimensions.width,i=Math.max(i,s.dimensions.up),o=Math.max(o,s.dimensions.down);t+=(n.length-1)*this.config.horizontalSeparation;const g=r.append("g").attr("class","railroad-sequence");let l=0;for(let s=0;s<n.length;s++){const h=n[s],u=i-h.dimensions.up;if(g.node().appendChild(h.element).setAttribute("transform",`translate(${l}, ${u})`),s<n.length-1){const w=l+h.dimensions.width,d=w+this.config.horizontalSeparation,T=i;g.append("path").attr("class","railroad-line").attr("d",new x().moveTo(w,T).lineTo(d,T).build())}l+=h.dimensions.width+this.config.horizontalSeparation}return{element:g.node(),dimensions:{width:t,height:i+o,up:i,down:o}}}renderChoice(r,a){const n=a.map(c=>this.renderExpression(r,c));let t=0,i=0;for(const c of n)t=Math.max(t,c.dimensions.width),i+=c.dimensions.height;i+=(n.length-1)*this.config.verticalSeparation;const o=this.config.arcRadius,g=o*4,l=t+g,s=r.append("g").attr("class","railroad-choice");let h=0;const u=i/2;for(const c of n){const w=h,d=w+c.dimensions.up,T=o*2+(t-c.dimensions.width)/2;s.node().appendChild(c.element).setAttribute("transform",`translate(${T}, ${w})`);const S=new x,v=d>u;d===u?S.moveTo(0,u).lineTo(T,d):S.moveTo(0,u).arcTo(o,o,0,!1,v,o,u+(v?o:-o)).lineTo(o,d-(v?o:-o)).arcTo(o,o,0,!1,!v,o*2,d).lineTo(T,d),s.append("path").attr("class","railroad-line").attr("d",S.build());const N=new x,_=T+c.dimensions.width,H=l-o*2;d===u?N.moveTo(_,d).lineTo(l,u):N.moveTo(_,d).lineTo(H,d).arcTo(o,o,0,!1,!v,l-o,d+(v?-o:o)).lineTo(l-o,u+(v?o:-o)).arcTo(o,o,0,!1,v,l,u),s.append("path").attr("class","railroad-line").attr("d",N.build()),h+=c.dimensions.height+this.config.verticalSeparation}return{element:s.node(),dimensions:{width:l,height:i,up:u,down:i-u}}}renderOptional(r,a){const n=this.renderExpression(r,a),t=this.config.arcRadius,i=t*2,o=n.dimensions.width+t*4,g=n.dimensions.height+i,l=r.append("g").attr("class","railroad-optional"),s=t*2,h=i;l.node().appendChild(n.element).setAttribute("transform",`translate(${s}, ${h})`);const c=h+n.dimensions.up,w=new x().moveTo(0,c).lineTo(t*2,c);l.append("path").attr("class","railroad-line").attr("d",w.build());const d=new x().moveTo(s+n.dimensions.width,c).lineTo(o,c);l.append("path").attr("class","railroad-line").attr("d",d.build());const T=new x().moveTo(0,c).arcTo(t,t,0,!1,!1,t,c-t).lineTo(t,t).arcTo(t,t,0,!1,!0,t*2,0).lineTo(o-t*2,0).arcTo(t,t,0,!1,!0,o-t,t).lineTo(o-t,c-t).arcTo(t,t,0,!1,!1,o,c);return l.append("path").attr("class","railroad-line").attr("d",T.build()),{element:l.node(),dimensions:{width:o,height:g,up:c,down:g-c}}}renderRepetition(r,a,n){const t=this.renderExpression(r,a),i=this.config.arcRadius,o=i*2,g=t.dimensions.width+i*4,l=n===0,s=t.dimensions.height+o+(l?o:0),h=r.append("g").attr("class","railroad-repetition"),u=i*2,c=l?o:0;h.node().appendChild(t.element).setAttribute("transform",`translate(${u}, ${c})`);const d=c+t.dimensions.up;h.append("path").attr("class","railroad-line").attr("d",new x().moveTo(0,d).lineTo(i*2,d).build()),h.append("path").attr("class","railroad-line").attr("d",new x().moveTo(u+t.dimensions.width,d).lineTo(g,d).build());const T=c+t.dimensions.height+i,z=new x().moveTo(u+t.dimensions.width,d).arcTo(i,i,0,!1,!0,u+t.dimensions.width+i,d+i).lineTo(u+t.dimensions.width+i,T).arcTo(i,i,0,!1,!0,u+t.dimensions.width,T+i).lineTo(i*2,T+i).arcTo(i,i,0,!1,!0,i,T).lineTo(i,d+i).arcTo(i,i,0,!1,!0,i*2,d);if(h.append("path").attr("class","railroad-line").attr("d",z.build()),l){const S=new x().moveTo(0,d).arcTo(i,i,0,!1,!1,i,d-i).lineTo(i,i).arcTo(i,i,0,!1,!0,i*2,0).lineTo(g-i*2,0).arcTo(i,i,0,!1,!0,g-i,i).lineTo(g-i,d-i).arcTo(i,i,0,!1,!1,g,d);h.append("path").attr("class","railroad-line").attr("d",S.build())}return{element:h.node(),dimensions:{width:g,height:s,up:d,down:s-d}}}renderSpecial(r,a){const n=this.measureText("? "+a+" ?"),t=n.width+this.config.padding*2,i=n.height+this.config.padding*2,o=r.append("g").attr("class","railroad-special");return o.append("rect").attr("x",0).attr("y",0).attr("width",t).attr("height",i),o.append("text").attr("x",t/2).attr("y",i/2).text("? "+a+" ?"),{element:o.node(),dimensions:{width:t,height:i,up:i/2,down:i/2}}}renderExpression(r,a){switch(a.type){case"terminal":return this.renderTerminal(r,a.value);case"nonterminal":return this.renderNonTerminal(r,a.name);case"sequence":return this.renderSequence(r,a.elements);case"choice":return this.renderChoice(r,a.alternatives);case"optional":return this.renderOptional(r,a.element);case"repetition":return this.renderRepetition(r,a.element,a.min);case"special":return this.renderSpecial(r,a.text);default:throw new Error(`Unknown node type: ${a.type}`)}}renderRule(r,a){const n=this.svg.append("g").attr("class","railroad-rule").attr("transform",`translate(0, ${a})`),t=r.name+" =",i=this.measureText(t).width+20,o=i+20,g=n.append("g"),l=this.renderExpression(g,r.definition),s=Math.max(20,l.dimensions.up),h=s-l.dimensions.up;return g.attr("transform",`translate(${o}, ${h})`),n.append("g").attr("class","railroad-rule-name-group").append("text").attr("class","railroad-rule-name").attr("x",0).attr("y",s).text(t),n.append("g").attr("class","railroad-start").append("circle").attr("cx",i).attr("cy",s).attr("r",this.config.markerRadius),n.append("g").attr("class","railroad-end").append("circle").attr("cx",o+l.dimensions.width+10).attr("cy",s).attr("r",this.config.markerRadius),n.append("path").attr("class","railroad-line").attr("d",new x().moveTo(i+this.config.markerRadius,s).lineTo(o,s).build()),n.append("path").attr("class","railroad-line").attr("d",new x().moveTo(o+l.dimensions.width,s).lineTo(o+l.dimensions.width+10-this.config.markerRadius,s).build()),{height:Math.max(40,h+l.dimensions.height+this.config.padding*2),width:o+l.dimensions.width+10+this.config.markerRadius}}renderDiagram(r){let a=this.config.padding,n=0;for(const t of r){const i=this.renderRule(t,a);a+=i.height+this.config.verticalSeparation,n=Math.max(n,i.width)}return{width:n+this.config.padding*2,height:a+this.config.padding}}},p($,"RailroadRenderer"),$),W=p((e,r,a)=>{U(e,r.height,r.width,a),e.attr("viewBox",`0 0 ${r.width} ${r.height}`)},"configureRailroadSvgSize"),ge=p((e,r,a)=>{k.debug(`[Railroad] Rendering diagram
`+e);try{const n=X(r);n.attr("class","railroad-diagram");const t=B().railroad,i=(t==null?void 0:t.useMaxWidth)??!0,o=oe.getRules();if(k.debug(`[Railroad] Rendering ${o.length} rules`),o.length===0){k.warn("[Railroad] No rules to render"),W(n,{height:100,width:200},i);return}const l=new ue(n,O()).renderDiagram(o);W(n,l,i),k.debug("[Railroad] Render complete")}catch(n){throw k.error("[Railroad] Render error:",n),n}},"draw"),xe={draw:ge};export{oe as d,Te as g,xe as r};
