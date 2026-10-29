// node web/tests/sun.test.mjs — checks the sun model against published
// Stockholm sunrise/sunset times (timeanddate.com, Stockholm city centre).
import { sunPosition, sunTimes, stockholmToUTC, utcToStockholm, stockholmOffset, fmtClock } from "../src/sun.js";

const LAT = 59.325, LON = 18.0708;
let fails = 0;
const check = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: got ${typeof got === "number" ? got.toFixed(2) : got}, want ${want} ±${tol}`);
};
const clockMin = (ms) => utcToStockholm(ms).minutes;
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

const cases = [
  // date, sunrise, sunset (local wall clock)
  [[2026, 11, 21], "08:43", "14:48"],
  [[2026, 5, 21], "03:31", "22:08"],
];
for (const [[y, m, d], rise, set] of cases) {
  const t = sunTimes(y, m, d, LAT, LON);
  check(`${y}-${m + 1}-${d} sunrise`, clockMin(t.sunrise), hm(rise), 3);
  check(`${y}-${m + 1}-${d} sunset`, clockMin(t.sunset), hm(set), 3);
  console.log(`     (${fmtClock(clockMin(t.sunrise))} – ${fmtClock(clockMin(t.sunset))})`);
}

// near the equinoxes day length is ~12h10m (refraction + disc radius)
for (const [y, m, d] of [[2026, 2, 20], [2026, 8, 23]]) {
  const t = sunTimes(y, m, d, LAT, LON);
  check(`${y}-${m + 1}-${d} day length (min)`, (t.sunset - t.sunrise) / 60000, 731, 6);
}

// midsummer solar noon elevation ≈ 90 - 59.325 + 23.44
const noon = sunTimes(2026, 5, 21, LAT, LON).noon;
check("midsummer noon elevation", sunPosition(noon, LAT, LON).elevation, 90 - LAT + 23.44, 0.1);
check("midsummer noon azimuth", sunPosition(noon, LAT, LON).azimuth, 180, 0.5);
check("midwinter noon elevation", sunPosition(sunTimes(2026, 11, 21, LAT, LON).noon, LAT, LON).elevation, 90 - LAT - 23.44 + 0.12, 0.1); // + refraction at 7°

// DST: 2026 CEST runs 29 Mar 01:00 UTC – 25 Oct 01:00 UTC
check("offset Jan", stockholmOffset(Date.UTC(2026, 0, 10)), 1, 0);
check("offset Jul", stockholmOffset(Date.UTC(2026, 6, 10)), 2, 0);
check("offset 28 Mar", stockholmOffset(Date.UTC(2026, 2, 28, 12)), 1, 0);
check("offset 29 Mar 02:00Z", stockholmOffset(Date.UTC(2026, 2, 29, 2)), 2, 0);
check("offset 25 Oct 02:00Z", stockholmOffset(Date.UTC(2026, 9, 25, 2)), 1, 0);
const u = stockholmToUTC(2026, 6, 1, 12 * 60);
check("12:00 CEST -> 10:00Z", new Date(u).getUTCHours(), 10, 0);
check("roundtrip", utcToStockholm(u).minutes, 720, 0);

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
