import { City, G } from "../src/city.js";
import { World } from "../src/collide.js";
let t = performance.now();
const c = new City(1337);
console.log("gen ms", (performance.now()-t)|0, "boxes", c.boxes.length, "far", c.far.length, "trees", c.trees.length, "lamps", c.lamps.length, "tokens", c.tokens.length, "meshes", c.meshes.length);
t = performance.now();
const w = new World(c);
console.log("world ms", (performance.now()-t)|0, "collide boxes", w.boxes.length, "grid", w.nx, w.nz);
const hs = c.boxes.filter(b=>!b.detail && b.style===1||b.style===2||b.style===3||b.style===4).map(b=>b.y1).sort((a,b)=>a-b);
console.log("height p10/50/90/max", hs[hs.length*0.1|0], hs[hs.length/2|0], hs[hs.length*0.9|0], hs[hs.length-1]);
console.log("island", G.ISLAND);
// ray straight down from high above an avenue should hit street at y=0
let h = w.raycast(G.X0 + 3*G.PX, 500, 0, 0, -1, 0, 1000); console.log("down avenue", h && h.y.toFixed(2), h && h.box);
h = w.raycast(G.X0 + 3*G.PX + 60, 1000, G.Z0+G.PZ*3+40, 0, -1, 0, 2000); console.log("down block", h && h.y.toFixed(2), h&&[h.nx,h.ny,h.nz]);
// sideways from avenue centre
h = w.raycast(G.X0 + 3*G.PX, 30, G.Z0+G.PZ*3+40, 1, 0, 0, 200); console.log("side", h && h.x.toFixed(2), h&&[h.nx,h.ny,h.nz]);
// brute-force check raycast vs naive
let bad=0; const R=Math.random;
t=performance.now();
for (let n=0;n<3000;n++){
  const o=[(R()-0.5)*2000, R()*150, (R()-0.5)*2500]; let d=[R()-0.5,R()-0.6,R()-0.5]; const L=Math.hypot(...d); d=d.map(v=>v/L);
  const hh = w.raycast(...o,...d,150); const got = hh? hh.t : Infinity;
  let best=Infinity;
  if (d[1]<0){const tt=-o[1]/d[1]; if(tt<150 && w.onIsland(o[0]+d[0]*tt,o[2]+d[2]*tt)) best=tt;}
  for (let k=0;k<w.boxes.length;k++){const b=w.b.subarray(k*6,k*6+6);
    let tmin=0,tmax=150; for(let a=0;a<3;a++){const t1=(b[a]-o[a])/d[a],t2=(b[a+3]-o[a])/d[a]; tmin=Math.max(tmin,Math.min(t1,t2)); tmax=Math.min(tmax,Math.max(t1,t2));}
    if (tmax>=tmin && tmin>0 && tmin<best) best=tmin;}
  if (Math.abs(best-got)>1e-3 && !(best===Infinity&&got===Infinity)) bad++;
}
console.log("ray mismatches", bad, "/3000");
t=performance.now(); for(let n=0;n<20000;n++){const d=[R()-0.5,R()*0.5+0.2,R()-0.5];const L=Math.hypot(...d);w.raycast(0,20,0,d[0]/L,d[1]/L,d[2]/L,120);} console.log("20k rays ms",(performance.now()-t)|0);
