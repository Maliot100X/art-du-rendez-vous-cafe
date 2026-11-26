import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
const d = JSON.parse(readFileSync('/tmp/fix19-screencast/data.json', 'utf8'))
const ROI = d.ROI
const t0 = d.speakLog[0]?.t0 ?? 0
// release: first bridge==0 in series+ring after mouth opened
const tl = [...d.series.map(p=>({t:p.t,bridge:p.bridge})), ...d.rbRing.map(p=>({t:p.t,bridge:p.bridge}))]
  .filter(p=>typeof p.t==='number'&&typeof p.bridge==='number'&&p.bridge>=0&&p.t>=t0)
const openTs = tl.filter(p=>p.bridge>=0.45).map(p=>p.t)
const firstOpen = openTs.length?Math.min(...openTs):null
const relTs = firstOpen!==null?tl.filter(p=>p.t>Math.max(t0+10000,firstOpen)&&p.bridge===0).map(p=>p.t):[]
const tEnd = relTs.length?Math.min(...relTs):t0+20000
console.log(`reply window t0=${Math.round(t0)} tEnd=${Math.round(tEnd)} (${((tEnd-t0)/1000).toFixed(1)}s)`)
const wallToPerf = (w)=> d.perfNow + (w - d.wallNow)
async function mouthMetrics(buf, crop){
  const {data,info}=await sharp(buf).extract({left:crop.x,top:crop.y,width:crop.w,height:crop.h}).raw().toBuffer({resolveWithObject:true})
  const ch=info.channels,W=crop.w,H=crop.h
  const lum=(i)=>0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]
  const rowMean=[]
  for(let y=0;y<H;y++){let s=0,n=0;for(let x=25;x<95;x++){s+=lum((y*W+x)*ch);n++}rowMean.push(s/n)}
  let min=Infinity;for(let y=0;y<H;y++)if(rowMean[y]<min)min=rowMean[y]
  let dark=0;for(let y=13;y<37;y++)for(let x=30;x<90;x++)if(lum((y*W+x)*ch)<120)dark++
  return {dipMin:Math.round(min),darkNarrow120:+(dark/1440).toFixed(4)}
}
const results=[]
for(const f of d.frameFiles){
  const meta=await sharp(f.file).metadata()
  const perf=wallToPerf(f.recvWall)
  const rel=(perf-t0)/1000
  const inWindow=perf>=t0-500&&perf<=tEnd+2000
  if(meta.width<ROI.x+ROI.w||meta.height<ROI.y+ROI.h){
    results.push({file:f.file.split('/').pop(),w:meta.width,h:meta.height,relSpeak:+rel.toFixed(1),inWindow,skip:`ROI out of frame (${meta.width}x${meta.height})`})
    continue
  }
  const m=await mouthMetrics(readFileSync(f.file),ROI)
  results.push({file:f.file.split('/').pop(),w:meta.width,h:meta.height,relSpeak:+rel.toFixed(1),inWindow,...m,open:m.dipMin<=184||m.darkNarrow120>=0.01})
}
for(const r of results) console.log(`${r.file} ${r.w}x${r.h} t${r.relSpeak>=0?'+':''}${r.relSpeak}s ${r.inWindow?'[IN WINDOW]':''} ${r.skip??`dipMin ${r.dipMin} dark ${r.darkNarrow120} -> ${r.open?'OPEN':'closed'}`}`)
const inW=results.filter(r=>r.inWindow&&!r.skip)
const open=inW.filter(r=>r.open)
console.log(`\nframes in reply window (ROI fittable): ${inW.length}; OPEN: ${open.length}`)
console.log(`frames skipped (ROI out of frame): ${results.filter(r=>r.skip).length}`)
console.log(`size histogram:`, JSON.stringify(results.reduce((a,r)=>{const k=`${r.w}x${r.h}`;a[k]=(a[k]??0)+1;return a},{})))
writeFileSync('/tmp/fix19-screencast/frame-analysis.json',JSON.stringify({t0,tEnd,results},null,2))
