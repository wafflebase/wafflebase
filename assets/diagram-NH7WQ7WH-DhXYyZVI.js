import{p as $}from"./chunk-JWPE2WC7-D25gkg98.js";import{_ as m,B as u,F as C,e as S,l as w,b as D,a as T,o as z,p as F,g as P,s as E,z as A,D as W,q as _}from"./mermaid.core-BD78mxvt.js";import{p as N}from"./cynefin-VYW2F7L2-AcwmZP0s.js";import"./index-C-mVZ7zv.js";import"./vendor-react-DhAurowr.js";import"./vendor-app-BUwhWW0L.js";import"./vendor-ui-C_-n-nOw.js";import"./vendor-yorkie-BweydLhv.js";import"./sheet-core-C95WHgl-.js";import"./sheet-formula-eval-D9XSud-I.js";import"./sheet-formula-parser-BTBd_EJX.js";import"./purify.es-Jn2rvFN8.js";import"./string-D05Vy0wW.js";var L=W.packet,b,v=(b=class{constructor(){this.packet=[],this.setAccTitle=D,this.getAccTitle=T,this.setDiagramTitle=z,this.getDiagramTitle=F,this.getAccDescription=P,this.setAccDescription=E}getConfig(){const t=u({...L,...A().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){_(),this.packet=[]}},m(b,"PacketDB"),b),M=1e4,Y=m((e,t)=>{$(e,t);let o=-1,r=[],n=1;const{bitsPerRow:l}=t.getConfig();for(let{start:a,end:s,bits:d,label:c}of e.blocks){if(a!==void 0&&s!==void 0&&s<a)throw new Error(`Packet block ${a} - ${s} is invalid. End must be greater than start.`);if(a??(a=o+1),a!==o+1)throw new Error(`Packet block ${a} - ${s??a} is not contiguous. It should start from ${o+1}.`);if(d===0)throw new Error(`Packet block ${a} is invalid. Cannot have a zero bit field.`);for(s??(s=a+(d??1)-1),d??(d=s-a+1),o=s,w.debug(`Packet block ${a} - ${o} with label ${c}`);r.length<=l+1&&t.getPacket().length<M;){const[p,i]=I({start:a,end:s,bits:d,label:c},n,l);if(r.push(p),p.end+1===n*l&&(t.pushWord(r),r=[],n++),!i)break;({start:a,end:s,bits:d,label:c}=i)}}t.pushWord(r)},"populate"),I=m((e,t,o)=>{if(e.start===void 0)throw new Error("start should have been set during first phase");if(e.end===void 0)throw new Error("end should have been set during first phase");if(e.start>e.end)throw new Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*o)return[e,void 0];const r=t*o-1,n=t*o;return[{start:e.start,end:r,label:e.label,bits:r-e.start},{start:n,end:e.end,label:e.label,bits:e.end-n}]},"getNextFittingBlock"),x={parser:{yy:void 0},parse:m(async e=>{var r;const t=await N("packet",e),o=(r=x.parser)==null?void 0:r.yy;if(!(o instanceof v))throw new Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");w.debug(t),Y(t,o)},"parse")},O=m((e,t,o,r)=>{const n=r.db,l=n.getConfig(),{rowHeight:a,paddingY:s,bitWidth:d,bitsPerRow:c}=l,p=n.getPacket(),i=n.getDiagramTitle(),h=a+s,g=h*(p.length+1)-(i?0:a),k=d*c+2,f=C(t);f.attr("viewBox",`0 0 ${k} ${g}`),S(f,g,k,l.useMaxWidth);for(const[y,B]of p.entries())j(f,B,y,l);f.append("text").text(i).attr("x",k/2).attr("y",g-h/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),j=m((e,t,o,{rowHeight:r,paddingX:n,paddingY:l,bitWidth:a,bitsPerRow:s,showBits:d})=>{const c=e.append("g"),p=o*(r+l)+l;for(const i of t){const h=i.start%s*a+1,g=(i.end-i.start+1)*a-n;if(c.append("rect").attr("x",h).attr("y",p).attr("width",g).attr("height",r).attr("class","packetBlock"),c.append("text").attr("x",h+g/2).attr("y",p+r/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(i.label),!d)continue;const k=i.end===i.start,f=p-2;c.append("text").attr("x",h+(k?g/2:0)).attr("y",f).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",k?"middle":"start").text(i.start),k||c.append("text").attr("x",h+g).attr("y",f).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(i.end)}},"drawWord"),q={draw:O},G={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},H=m(({packet:e}={})=>{const t=u(G,e);return`
	.packetByte {
		font-size: ${t.byteFontSize};
	}
	.packetByte.start {
		fill: ${t.startByteColor};
	}
	.packetByte.end {
		fill: ${t.endByteColor};
	}
	.packetLabel {
		fill: ${t.labelColor};
		font-size: ${t.labelFontSize};
	}
	.packetTitle {
		fill: ${t.titleColor};
		font-size: ${t.titleFontSize};
	}
	.packetBlock {
		stroke: ${t.blockStrokeColor};
		stroke-width: ${t.blockStrokeWidth};
		fill: ${t.blockFillColor};
	}
	`},"styles"),it={parser:x,get db(){return new v},renderer:q,styles:H};export{it as diagram};
