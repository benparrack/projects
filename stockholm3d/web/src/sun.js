// Solar position + sunrise/sunset (NOAA spreadsheet algorithm) and Stockholm
// local time (CET/CEST, EU DST rule). No DOM; also runs under Node for tests.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function solarParams(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTime = 4 * DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr)); // minutes
  return { decl, eqTime };
}

/** Sun position at a UTC timestamp (ms). azimuth: degrees clockwise from north;
 *  elevation: degrees above the horizon, refraction-corrected. */
export function sunPosition(ms, lat, lon) {
  const { decl, eqTime } = solarParams(ms);
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  const tst = minutes + eqTime + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let elev = 90 - zen * DEG;
  // atmospheric refraction (NOAA)
  let refr = 0;
  if (elev <= 85) {
    const te = Math.tan(elev * RAD);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  elev += refr;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * DEG + 180 + 360) % 360;
  return { azimuth: az, elevation: elev, declination: decl * DEG };
}

/** Sunrise / solar noon / sunset (UTC ms) for the UTC calendar day containing
 *  `dayMs`'s local date. `null` rise/set when the sun doesn't cross the horizon. */
export function sunTimes(y, m, d, lat, lon, depression = 0.833) {
  const day0 = Date.UTC(y, m, d);
  const phi = lat * RAD;
  const at = (guessMin, sign) => {
    let t = guessMin;
    for (let k = 0; k < 3; k++) {
      const { decl, eqTime } = solarParams(day0 + t * 60000);
      const noon = 720 - 4 * lon - eqTime;
      if (sign === 0) { t = noon; continue; }
      const c = Math.cos((90 + depression) * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
      if (c < -1 || c > 1) return null;
      t = noon + sign * 4 * Math.acos(c) * DEG;
    }
    return day0 + t * 60000;
  };
  return { sunrise: at(360, -1), noon: at(720, 0), sunset: at(1080, 1) };
}

// --- Europe/Stockholm local time without relying on the viewer's time zone
function lastSundayUTC(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** UTC offset (hours) in Stockholm at a UTC instant: CEST from the last Sunday
 *  of March 01:00 UTC to the last Sunday of October 01:00 UTC. */
export function stockholmOffset(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSundayUTC(y, 2), 1);
  const end = Date.UTC(y, 9, lastSundayUTC(y, 9), 1);
  return ms >= start && ms < end ? 2 : 1;
}

/** Stockholm wall-clock (y, m 0-based, d, minutes past midnight) -> UTC ms. */
export function stockholmToUTC(y, m, d, minutes) {
  const naive = Date.UTC(y, m, d, 0, 0) + minutes * 60000;
  let ms = naive - 3600000;
  ms = naive - stockholmOffset(ms) * 3600000;
  return ms;
}

/** UTC ms -> Stockholm wall clock {y, m, d, minutes, offset}. */
export function utcToStockholm(ms) {
  const off = stockholmOffset(ms);
  const t = new Date(ms + off * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60, offset: off };
}

export function fmtClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Local sidereal time in degrees (for rotating the star field). */
export function siderealDeg(ms, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * (0.000387933 - T / 38710000);
  return ((gmst + lon) % 360 + 360) % 360;
}
