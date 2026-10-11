export interface PaletteColor { hex:string; fraction:number }
export function imagePalette(image:HTMLImageElement):PaletteColor[]{
  const canvas=document.createElement('canvas'),ratio=Math.min(1,112/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('浏览器无法提取色板。');ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels:number[][]=[];for(let i=0;i<data.length;i+=4)if(data[i+3]>=128)pixels.push([data[i],data[i+1],data[i+2]]);
  if(!pixels.length)throw new Error('图片没有可提取的非透明像素。');
  const distance=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+(v-b[i])**2,0),centers=[pixels[Math.floor(pixels.length/2)].slice()];
  while(centers.length<6){let max=0,farthest:number[]|null=null;for(const p of pixels){const d=Math.min(...centers.map(c=>distance(c,p)));if(d>max){max=d;farthest=p;}}if(max<100||!farthest)break;centers.push(farthest.slice());}
  let buckets=centers.map(()=>({sum:[0,0,0],count:0}));
  for(let pass=0;pass<10;pass++){buckets=centers.map(()=>({sum:[0,0,0],count:0}));for(const p of pixels){let nearest=0,dist=Infinity;centers.forEach((c,i)=>{const d=distance(c,p);if(d<dist){nearest=i;dist=d;}});const b=buckets[nearest];b.count++;p.forEach((v,i)=>b.sum[i]+=v);}buckets.forEach((b,i)=>{if(b.count)centers[i]=b.sum.map(v=>v/b.count);});}
  return buckets.map((b,i)=>({hex:'#'+centers[i].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase(),fraction:b.count/pixels.length})).filter(c=>c.fraction>0).sort((a,b)=>b.fraction-a.fraction);
}
