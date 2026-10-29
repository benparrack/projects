// Integrates each attractor to find its center, scale and mean speed; the shader's
// per-scene constants (C, S, K in index.html) come from this. Asserts each stays bounded.
const A = {
  lorenz:    ([x,y,z]) => [10*(y-x), x*(28-z)-y, x*y-8/3*z],
  thomas:    ([x,y,z]) => [Math.sin(y)-.19*x, Math.sin(z)-.19*y, Math.sin(x)-.19*z],
  halvorsen: ([x,y,z]) => [-1.89*x-4*y-4*z-y*y, -1.89*y-4*z-4*x-z*z, -1.89*z-4*x-4*y-x*x],
  dadras:    ([x,y,z]) => [y-3*x+2.7*y*z, 1.7*y-x*z+z, 2*x*y-9*z],
  rossler:   ([x,y,z]) => [-y-z, x+.2*y, .2+z*(x-5.7)],
  fourwing:  ([x,y,z]) => [.2*x+y*z, .01*x-.4*y-x*z, -z-x*y],
  chenlee:   ([x,y,z]) => [5*x-y*z, -10*y+x*z, -.38*z+x*y/3],
};
for (const [name, f] of Object.entries(A)) {
  let p = [0.1, 0.12, 0.13], h = 0.002;
  const lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9]; let sp = 0, n = 0;
  for (let i = 0; i < 400000; i++) {
    const k1 = f(p), m = p.map((v,j)=>v+k1[j]*h/2), k2 = f(m);
    p = p.map((v,j)=>v+k2[j]*h);
    if (!p.every(Number.isFinite) || Math.hypot(...p) > 1e4) throw new Error(name + ' diverged');
    if (i > 50000) { for (let j=0;j<3;j++){lo[j]=Math.min(lo[j],p[j]);hi[j]=Math.max(hi[j],p[j]);} sp += Math.hypot(...k2); n++; }
  }
  const c = lo.map((v,j)=>(v+hi[j])/2), s = Math.max(...hi.map((v,j)=>v-lo[j]))/2;
  console.log(name.padEnd(10), 'C', c.map(v=>v.toFixed(3)).join(','), ' S', s.toFixed(3), ' meanSpeed/S', (sp/n/s).toFixed(3));
}

// Second check: mirror the shader's world-space field and drop 2000 particles from the unit
// ball. Reports escapes (respawned in the app) and how spread out the cloud ends up.
const SH = { // name: [C, S, K] exactly as in index.html
  lorenz: [[0,0,23.3], 25.4, .119], thomas: [[0,0,0], 4.086, 2.24],
  halvorsen: [[-2.666,-2.666,-2.666], 9.229, .108], dadras: [[1.05,-.15,.35], 9.5, .616],
  rossler: [[-.5,-1.3,.72], 9.0, .587], chenlee: [[0,0,7.42], 14.87, .33],
};
for (const [name, [C, S, K]] of Object.entries(SH)) {
  const f = A[name];
  const wf = p => { const q = [C[0]+S*p[0], C[1]+S*p[2], C[2]+S*p[1]]; const d = f(q); return [d[0]/S*K, d[2]/S*K, d[1]/S*K]; };
  let pts = Array.from({length: 2000}, () => { let v; do v = [0,0,0].map(()=>Math.random()*2-1); while (Math.hypot(...v) > 1); return v; });
  let esc = 0; const dt = 1/60;
  for (let s = 0; s < 60*30; s++) pts = pts.map(p => {
    const v1 = wf(p), m = p.map((x,j)=>x+v1[j]*dt/2), v = wf(m), n = p.map((x,j)=>x+v[j]*dt);
    if (!(Math.hypot(...n) < 3)) { esc++; return [Math.random()-.5, Math.random()-.5, Math.random()-.5]; }
    return n;
  });
  const mean = [0,1,2].map(j => pts.reduce((a,p)=>a+p[j],0)/pts.length);
  const sd = [0,1,2].map(j => Math.sqrt(pts.reduce((a,p)=>a+(p[j]-mean[j])**2,0)/pts.length));
  const r95 = pts.map(p => Math.hypot(p[0]-mean[0], p[1]-mean[1], p[2]-mean[2])).sort((a,b)=>a-b)[Math.floor(pts.length*.95)];
  const C2 = [C[0]+S*mean[0], C[1]+S*mean[2], C[2]+S*mean[1]];
  console.log(name.padEnd(10), 'recentred C', C2.map(v=>v.toFixed(3)).join(','), ' r95', r95.toFixed(2));
  console.log(name.padEnd(10), 'escapes', String(esc).padStart(6), ' mean', mean.map(v=>v.toFixed(2)).join(','), ' sd', sd.map(v=>v.toFixed(2)).join(','));
  if (esc > 2000) throw new Error(name + ': most particles escape');
}
