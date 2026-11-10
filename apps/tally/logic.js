// Tally logic: energy math, plans, weight trend, search. Pure functions, no DOM, so test.js can run them in Node.
(() => {
const L = {};
const DAY = 86400000;

// ---- dates: local calendar days as 'YYYY-MM-DD' ----
const pad = n => String(n).padStart(2, '0');
L.day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
L.date = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
L.addDays = (key, n) => { const d = L.date(key); d.setDate(d.getDate() + n); return L.day(d); };
L.diffDays = (a, b) => Math.round((L.date(b) - L.date(a)) / DAY); // b - a
L.weekday = key => L.date(key).getDay(); // 0 = Sunday

// ---- units ----
L.KG = 2.20462;
L.CM = 2.54;
L.round = (n, step = 1) => Math.round(n / step) * step;

// ---- energy ----
L.KCAL_PER_LB = 3500;
L.ACTIVITY = [
  { id: 'low', f: 1.2, name: 'Mostly sitting', desc: 'Desk or classes most of the day, under 5,000 steps, little exercise.' },
  { id: 'light', f: 1.375, name: 'Lightly active', desc: 'Some walking (5–8k steps) or 1–3 workouts a week.' },
  { id: 'active', f: 1.55, name: 'Active', desc: 'Lots of walking (8k+ steps) and 3–5 workouts a week.' },
  { id: 'very', f: 1.725, name: 'Very active', desc: 'On your feet all day, or hard training 6–7 days a week.' },
];
L.age = (p, today = L.day()) => Number(today.slice(0, 4)) - p.birthYear;
// Mifflin-St Jeor, the most accurate of the standard formulas for most people.
L.bmr = (p, lb, today) => 10 * lb / L.KG + 6.25 * p.heightIn * L.CM - 5 * L.age(p, today) + (p.sex === 'f' ? -161 : 5);
L.maintenance = (p, lb, today) => L.bmr(p, lb, today) * (L.ACTIVITY.find(a => a.id === p.activity) || L.ACTIVITY[1]).f;
L.floor = p => p.sex === 'f' ? 1200 : 1500; // below this it gets hard to cover nutrients
L.healthyRange = p => { const m = (p.heightIn * L.CM / 100) ** 2; return [18.5 * m * L.KG, 24.9 * m * L.KG]; };
L.protein = (goalLb, lb) => Math.min(200, L.round(0.8 * Math.min(goalLb, lb + 10), 5)); // ~1.8 g/kg of goal weight

const PACES = {
  lose: [
    { id: 'easy', name: 'Easy', rate: -0.5, feel: 'Barely feels like a diet. Room for meals out and the odd treat most days.' },
    { id: 'steady', name: 'Steady', rate: -1, feel: 'Noticeable but manageable. Some hungry evenings, especially the first two weeks.' },
    { id: 'fast', name: 'Fast', rate: -1.5, feel: 'Hungry most days. Needs high protein and planning. Best kept to a few months.' },
  ],
  gain: [
    { id: 'lean', name: 'Lean', rate: 0.25, feel: 'Slow, mostly muscle if you train. Fewer clothes that stop fitting.' },
    { id: 'steady', name: 'Steady', rate: 0.5, feel: 'Faster gains, some fat along with it. Good if you are lifting hard.' },
  ],
};

// Plan choices for a goal. `by` is an optional target day; options that reach the goal by then are marked.
L.planOptions = ({ profile, lb, goalLb, by, today = L.day() }) => {
  const maint = L.maintenance(profile, lb, today), floor = L.floor(profile), diff = goalLb - lb;
  const dir = Math.abs(diff) < 1 ? 'maintain' : diff < 0 ? 'lose' : 'gain';
  const maxLoss = lb * 0.01; // past ~1% of body weight a week, more of the loss is muscle
  const make = (o, rate) => {
    let kcal = L.round(maint + rate * L.KCAL_PER_LB / 7, 10), capped = false;
    if (kcal < floor) { kcal = floor; rate = (floor - maint) * 7 / L.KCAL_PER_LB; capped = true; }
    const weeks = rate ? diff / rate : 0;
    return { ...o, rate, kcal, capped, weeks, finish: rate ? L.addDays(today, Math.ceil(weeks * 7)) : null };
  };
  let options;
  if (dir === 'maintain') options = [make({ id: 'maintain', name: 'Maintain', feel: 'Eat at maintenance and keep your weight steady.' }, 0)];
  else options = PACES[dir].filter(o => dir === 'gain' || -o.rate <= maxLoss + 0.05 || o.id === 'easy').map(o => make(o, o.rate));
  // Drop duplicates the calorie floor squashed together (small or very active people).
  options = options.filter((o, i) => !options.slice(0, i).some(x => x.kcal === o.kcal));
  let needed = null;
  if (by && dir !== 'maintain') {
    const weeks = L.diffDays(today, by) / 7;
    needed = weeks > 0 ? diff / weeks : Infinity * Math.sign(diff);
    for (const o of options) o.meets = o.finish <= by;
    const tooFast = dir === 'lose' ? -needed > maxLoss : needed > 0.75;
    // A date between two presets gets its own exact option.
    if (!tooFast && !options.some(o => Math.abs(o.rate - needed) < 0.1)) {
      const o = make({ id: 'date', name: 'Your date', feel: 'The exact pace that lands on your date.' }, needed);
      if (!o.capped) { o.meets = true; options.push(o); options.sort((a, b) => Math.abs(a.rate) - Math.abs(b.rate)); }
    }
  }
  return { dir, maint: L.round(maint, 10), floor, options, needed, maxLoss };
};

// Calories for one day. Flex days get a bonus paid for by the other days, so the week adds up the same.
L.budget = (plan, key) => {
  const flex = plan.flex || [];
  if (!flex.length || !plan.bonus || flex.length === 7) return plan.kcal;
  return flex.includes(L.weekday(key)) ? plan.kcal + plan.bonus : L.round(plan.kcal - plan.bonus * flex.length / (7 - flex.length), 10);
};

// ---- weight trend ----
// Exponential moving average (10% a day), the "Hacker's Diet" trend: it irons out water and food weight
// so a salty dinner doesn't look like a pound of fat. Gaps decay the old trend as if each day was weighed.
L.trend = weights => {
  const days = Object.keys(weights).sort();
  let t = null, prev = null;
  return days.map(day => {
    const lb = weights[day];
    if (t === null) t = lb;
    else t += (1 - 0.9 ** Math.min(L.diffDays(prev, day), 30)) * (lb - t);
    prev = day;
    return { day, lb, trend: t };
  });
};
L.trendOn = (series, key) => { let v = null; for (const s of series) { if (s.day > key) break; v = s.trend; } return v; };

// Least-squares slope of the trend over the last `days`, in lb per week. Null without two weeks of data.
L.rate = (series, today, days = 28) => {
  const from = L.addDays(today, -days), pts = series.filter(s => s.day >= from && s.day <= today);
  if (pts.length < 4 || L.diffDays(pts[0].day, pts[pts.length - 1].day) < 10) return null;
  const xs = pts.map(s => L.diffDays(from, s.day)), ys = pts.map(s => s.trend);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den * 7 : null;
};

// When you'll reach the goal at the current rate (null if heading the wrong way or too slow to matter).
L.eta = (trendLb, goalLb, rate, today) => {
  const left = goalLb - trendLb;
  if (Math.abs(left) < 0.5) return today;
  if (!rate || Math.sign(rate) !== Math.sign(left) || Math.abs(rate) < 0.1) return null;
  return L.addDays(today, Math.ceil(left / rate * 7));
};

// Where the plan says you should be on a given day.
L.planned = (plan, key) => {
  const w = plan.startLb + plan.rate * L.diffDays(plan.start, key) / 7;
  return plan.rate < 0 ? Math.max(w, plan.goalLb) : plan.rate > 0 ? Math.min(w, plan.goalLb) : plan.startLb;
};

// ---- food ----
L.parseDB = text => text.trim().split('\n').map(line => {
  const [name, k, p, c, f, serv = '', flags = ''] = line.split('|');
  return {
    id: 'db:' + L.norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, src: 'db',
    k: +k, p: +p, c: +c, f: +f, ml: flags.includes('ml'), alc: flags.includes('alc'),
    servings: serv ? serv.split(';').map(s => { const i = s.lastIndexOf('='); return { label: s.slice(0, i), g: +s.slice(i + 1) }; }) : [],
  };
});
L.of = (food, g) => ({ kcal: food.k * g / 100, p: food.p * g / 100, c: food.c * g / 100, f: food.f * g / 100 });
L.sum = entries => entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
// The amount a food defaults to: what you used last time, else its first serving, else 100 g.
L.defaultAmount = food => food.last || (food.servings[0] ? { qty: 1, g: food.servings[0].g, label: food.servings[0].label } : { qty: 100, g: 1, label: food.ml ? 'ml' : 'g' });
L.amountText = a => a.g === 1 ? `${L.trim(a.qty)} ${a.label}` : a.qty === 1 ? a.label : `${L.frac(a.qty)} × ${a.label}`;
L.trim = n => String(Math.round(n * 10) / 10);
L.frac = q => ({ 0.25: '¼', 0.5: '½', 0.75: '¾', 1.5: '1½', 2.5: '2½', 0.33: '⅓' })[Math.round(q * 100) / 100] || L.trim(q);

L.norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Every query word has to match the start of some word in the name. Earlier and more-used foods rank higher.
L.search = (foods, q, limit = 40) => {
  const terms = L.norm(q).split(/[^a-z0-9%]+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const food of foods) {
    const name = L.norm(food.name + ' ' + (food.brand || '')), words = name.split(/[^a-z0-9%]+/);
    let score = 0, ok = true;
    for (const t of terms) {
      const w = words.findIndex(w => w.startsWith(t));
      if (w < 0) { if (t.length >= 3 && name.includes(t)) score += 1; else { ok = false; break; } }
      else score += w === 0 ? 6 : 3 - Math.min(w, 2) * 0.5;
    }
    if (!ok) continue;
    score += Math.min(food.uses || 0, 20) * 0.4 + (food.src === 'db' ? 0 : 1) - (words.length - terms.length) * 0.1; // ties keep list order
    out.push({ food, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.food);
};

// Open Food Facts product to a Tally food. Rejects entries with missing or nonsense numbers (common there).
L.fromOFF = p => {
  const n = p.nutriments || {};
  let k = n['energy-kcal_100g'];
  if (k == null && n['energy-kj_100g'] != null) k = n['energy-kj_100g'] / 4.184;
  if (k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
  const name = (p.product_name || p.product_name_en || p.product_name_sv || '').trim();
  if (!name || k == null || !(k >= 0 && k <= 950)) return null;
  const pr = +n.proteins_100g || 0, c = +n.carbohydrates_100g || 0, f = +n.fat_100g || 0;
  const atw = 4 * pr + 4 * c + 9 * f;
  if (k > 40 && atw > 0 && (atw / k > 1.6 || atw / k < 0.45)) return null;
  const brand = String(p.brands || '').split(',')[0].trim();
  const ml = /\bml\b|\bcl\b|\bl\b/i.test(p.serving_size || p.quantity || '');
  const sq = +p.serving_quantity;
  return {
    id: 'off:' + p.code, code: p.code, name, brand, src: 'off', ml, alc: false,
    k: L.round(+k, 0.1), p: L.round(pr, 0.1), c: L.round(c, 0.1), f: L.round(f, 0.1),
    servings: sq > 0 && sq < 3000 ? [{ label: (p.serving_size || 'serving').trim().slice(0, 40), g: sq }] : [],
  };
};

// Foods worth eating with what's left today: fits the calories, and favours protein when that's behind.
L.suggest = (foods, kcalLeft, proteinLeft) => {
  if (kcalLeft < 60) return [];
  const wantP = proteinLeft > 15;
  return foods.map(food => {
    const a = L.defaultAmount(food), n = L.of(food, a.qty * a.g);
    return { food, a, n };
  }).filter(({ food, n }) => n.kcal >= 40 && n.kcal <= kcalLeft && !food.alc && (!wantP || n.p * 4 / n.kcal >= 0.25))
    .sort((x, y) => (wantP ? y.n.p / y.n.kcal - x.n.p / x.n.kcal : 0) * 4 + ((y.food.uses || 0) - (x.food.uses || 0)) * 0.05 || y.n.kcal - x.n.kcal)
    .slice(0, 6);
};

// ---- history ----
L.dayTotal = (state, key) => L.sum((state.days[key] || {}).entries || []);
L.logged = (state, key) => ((state.days[key] || {}).entries || []).length > 0;
L.streak = (state, today) => {
  let key = L.logged(state, today) ? today : L.addDays(today, -1), n = 0;
  while (L.logged(state, key)) { n++; key = L.addDays(key, -1); }
  return n;
};
// Your real maintenance: average intake minus the energy in the trend's change. Needs a few weeks of honest logs.
L.measuredMaintenance = (state, today, days = 28) => {
  const end = L.addDays(today, -1), start = L.addDays(end, -(days - 1));
  const series = L.trend(state.weights);
  const inWin = series.filter(s => s.day >= start && s.day <= end);
  const logged = [];
  for (let k = start; k <= end; k = L.addDays(k, 1)) if (L.logged(state, k)) logged.push(L.dayTotal(state, k).kcal);
  if (logged.length < 14 || inWin.length < 6) return { ready: false, logged: logged.length, weighed: inWin.length };
  const span = L.diffDays(inWin[0].day, inWin[inWin.length - 1].day);
  if (span < 14) return { ready: false, logged: logged.length, weighed: inWin.length };
  const change = inWin[inWin.length - 1].trend - inWin[0].trend;
  const intake = logged.reduce((a, b) => a + b) / logged.length;
  return { ready: true, kcal: L.round(intake - change * L.KCAL_PER_LB / span, 10), intake: L.round(intake, 10), logged: logged.length, change };
};

L.mealFor = hour => hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 17 ? 'snacks' : hour < 21 ? 'dinner' : 'snacks';
L.MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];

window.Logic = L;
})();
