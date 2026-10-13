// Stick-figure poses drawn from segment angles, so every figure keeps the same proportions.
// Angles are degrees in SVG space: 0 = right, 90 = down, -90 = up, 180 = left.
// Side-view figures face right. "1" limbs are the near side (drawn on top), "2" the far side.
(function (root) {
  const L = { torso: 29, neck: 5, head: 6.4, thigh: 23, shin: 22, foot: 6, upper: 14, fore: 14 };
  const W = 160, H = 108, FLOOR = 100, SW = 4.6; // viewBox, floor line, stroke width
  const rad = d => d * Math.PI / 180;
  const step = (p, ang, len) => [p[0] + Math.cos(rad(ang)) * len, p[1] + Math.sin(rad(ang)) * len];

  // Pose: { t: torso angle (pelvis->shoulders), hd: head tilt vs torso,
  //         l1/l2: [thigh, shin, foot?, thighScale?, shinScale?], a1/a2: [upper, fore, scales?], ts: torso scale
  //         (scales < 1 foreshorten a limb pointing at the viewer), hi: highlighted segment names,
  //         props: ['wall','strap','chair','bed','block'], wall: 'left'|'right' }
  function joints(p) {
    const P = [0, 0], S = step(P, p.t, L.torso * (p.ts || 1));
    const Hd = step(S, p.t + (p.hd || 0), L.neck + L.head);
    const j = { P, S, Hd };
    for (const n of ['1', '2']) {
      const [th, sh, ft, ks = 1, ss = 1] = p['l' + n], K = step(P, th, L.thigh * ks), F = step(K, sh, L.shin * ss);
      j['K' + n] = K; j['F' + n] = F;
      if (ft != null) j['T' + n] = step(F, ft, L.foot);
      const [ua, fa, us = 1, fs = 1] = p['a' + n], E = step(S, ua, L.upper * us);
      j['E' + n] = E; j['W' + n] = step(E, fa, L.fore * fs);
    }
    return j;
  }

  const SEGS = { torso: ['P', 'S'], thigh1: ['P', 'K1'], shin1: ['K1', 'F1'], foot1: ['F1', 'T1'], thigh2: ['P', 'K2'],
    shin2: ['K2', 'F2'], foot2: ['F2', 'T2'], upper1: ['S', 'E1'], fore1: ['E1', 'W1'], upper2: ['S', 'E2'], fore2: ['E2', 'W2'] };
  const FAR = ['thigh2', 'shin2', 'foot2', 'upper2', 'fore2'], NEAR = ['torso', 'thigh1', 'shin1', 'foot1', 'upper1', 'fore1'];

  function svg(pose, opts = {}) {
    const j = joints(pose), pts = Object.values(j);
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const minX = Math.min(...xs) - L.head, maxX = Math.max(...xs) + L.head;
    const minY = Math.min(Math.min(...ys), j.Hd[1] - L.head), maxY = Math.max(...ys);
    const s = Math.min(1.3, (H - 8) / (maxY - minY + SW), (W - 16) / (maxX - minX)); // shrink tall/wide poses to fit
    const props = pose.props || [], base = props.includes('bed') ? FLOOR - 14 : FLOOR; // figures on a bed rest on its top
    const dx = W / 2 - (minX + maxX) / 2 * s, dy = base - SW / 2 - maxY * s;
    const T = q => [(q[0] * s + dx).toFixed(1), (q[1] * s + dy).toFixed(1)];
    const hi = new Set(pose.hi || []);
    const seg = (name, cls) => {
      const [a, b] = SEGS[name]; if (!j[a] || !j[b]) return '';
      const [x1, y1] = T(j[a]), [x2, y2] = T(j[b]);
      return `<line class="${cls}${hi.has(name) ? ' hi' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    };
    let out = '';
    const fx = q => T(q)[0], fy = q => T(q)[1];
    if (props.includes('wall')) {
      const wx = pose.wall === 'left' ? Math.min(...xs.map(x => x * s + dx)) - 3 : Math.max(...xs.map(x => x * s + dx)) + 3;
      out += `<line class="prop" x1="${wx.toFixed(1)}" y1="6" x2="${wx.toFixed(1)}" y2="${FLOOR}"/>`;
    }
    if (props.includes('chair')) { // seat under the pelvis, legs down to the floor
      const x = +fx(j.P), y = +fy(j.P) + 4;
      out += `<path class="prop" d="M${x - 14} ${y}h20M${x - 12} ${y}v${FLOOR - y}M${x + 4} ${y}v${FLOOR - y}M${x - 14} ${y}v-30"/>`;
    }
    if (props.includes('bed')) out += `<rect class="prop bed" x="8" y="${base}" width="${W - 16}" height="${FLOOR - base}" rx="4"/>`;
    if (props.includes('block')) { // a step, chair or sofa under the near foot
      const x = +fx(j.F1), y = +fy(j.F1) + SW / 2;
      out += `<rect class="prop bed" x="${(x - 12).toFixed(1)}" y="${y.toFixed(1)}" width="24" height="${(FLOOR - y).toFixed(1)}" rx="2"/>`;
    }
    out += `<line class="floor" x1="4" y1="${FLOOR}" x2="${W - 4}" y2="${FLOOR}"/>`;
    out += FAR.map(n => seg(n, 'far')).join('');
    if (props.includes('strap')) out += `<line class="strap" x1="${fx(j.W1)}" y1="${fy(j.W1)}" x2="${fx(j.F1)}" y2="${fy(j.F1)}"/>`;
    out += NEAR.map(n => seg(n, 'near')).join('');
    const [hx, hy] = T(j.Hd);
    out += `<circle class="head" cx="${hx}" cy="${hy}" r="${(L.head * s).toFixed(1)}"/>`;
    const label = opts.label ? ` role="img" aria-label="${opts.label}"` : ' aria-hidden="true"';
    return `<svg class="fig" viewBox="0 0 ${W} ${H}"${label}>${out}</svg>`;
  }

  root.Figure = { svg, joints, L };
})(typeof window !== 'undefined' ? window : globalThis);
