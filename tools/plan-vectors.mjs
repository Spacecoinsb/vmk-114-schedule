// Black line work of the vector floor plans in map coordinates → tools/out/plan-vectors.json.
// Floors 6 and 7 are scanned images inside the PDF; tools/plan-features.html reads those from public/map.
//   node tools/plan-vectors.mjs
import * as pdfjs from '../public/vendor/pdf.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

const {floors}=JSON.parse(await readFile('lib/map-data.json','utf8'));
// Same page crop as tools/build_map.py, in a 2000-px-wide page frame.
const CROP={1:[20,140,1980,965],2:[25,135,1975,935],5:[95,185,1900,725]};
const PAGE={1:2,2:3,5:4};
const doc=await pdfjs.getDocument({data:new Uint8Array(await readFile('tools/floor-plans.pdf')),verbosity:0}).promise;
const O=pdfjs.OPS, out={};
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
for (const f of floors.filter(f=>PAGE[f.floor])) {
  const page=await doc.getPage(PAGE[f.floor]), [,,PW,PH]=page.view, k=2000/PW;
  const [cx0,cy0,cx1,cy1]=CROP[f.floor], [ix0,iy0,ix1,iy1]=f.imageBox;
  const M=(x,y)=>[Math.round((ix0+(x*k-cx0)*(ix1-ix0)/(cx1-cx0))*10)/10, Math.round((iy0+((PH-y)*k-cy0)*(iy1-iy0)/(cy1-cy0))*10)/10];
  const ops=await page.getOperatorList(), lines=[], stack=[];
  let ctm=[1,0,0,1,0,0], st={sc:'0,0,0',dash:''}, path=null;
  const T=(x,y)=>M(ctm[0]*x+ctm[2]*y+ctm[4], ctm[1]*x+ctm[3]*y+ctm[5]);
  for (let i=0;i<ops.fnArray.length;i++) {
    const fn=ops.fnArray[i], a=ops.argsArray[i];
    if (fn===O.save) stack.push([ctm,{...st}]); else if (fn===O.restore) [ctm,st]=stack.pop()??[ctm,st];
    else if (fn===O.transform) ctm=mul(ctm,a);
    else if (fn===O.setStrokeRGBColor) st.sc=Array.from(a).join(',');
    else if (fn===O.setDash) st.dash=Array.from(a[0]).join(',');
    else if (fn===O.constructPath) {
      const [cmds,xy]=a; let j=0, p=null; path=[];
      for (const c of cmds) {
        if (c===O.moveTo) { p=[T(xy[j],xy[j+1])]; path.push(p); j+=2; }
        else if (c===O.lineTo) { if(!p){p=[];path.push(p);} p.push(T(xy[j],xy[j+1])); j+=2; }
        else if (c===O.curveTo) { p?.push(T(xy[j+4],xy[j+5])); j+=6; }
        else if (c===O.curveTo2||c===O.curveTo3) { p?.push(T(xy[j+2],xy[j+3])); j+=4; }
        else if (c===O.rectangle) { const [x,y,w,h]=xy.slice(j,j+4); path.push([T(x,y),T(x+w,y),T(x+w,y+h),T(x,y+h),T(x,y)]); j+=4; }
        else if (c===O.closePath) { if(p?.length) p.push(p[0]); }
      }
    } else if ((fn===O.stroke||fn===O.closeStroke) && path) {
      // Solid black strokes are the architecture; colour marks the evacuation signage.
      if (st.sc==='0,0,0' && !st.dash) for (const p of path) if (p.length>1) lines.push(fn===O.closeStroke?[...p,p[0]]:p);
      path=null;
    } else if (fn!==O.setLineWidth && fn!==O.setLineCap && fn!==O.setLineJoin && fn!==O.setMiterLimit && fn!==O.setFillRGBColor && fn!==O.setGState) path=null;
  }
  out[f.floor]=lines;
  console.log(`Floor ${f.floor}: ${lines.length} strokes`);
}
await mkdir('tools/out',{recursive:true});
await writeFile('tools/out/plan-vectors.json',JSON.stringify(out));
