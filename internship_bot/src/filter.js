// Rule filter: drops postings Ben can't or won't apply to. Returns null if OK, else a skip reason.
const US = /(,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|PR)\b)|\b(USA?|United States|Remote in USA)\b|^Remote$/i;

export function skipReason(j) {
  const t = j.title;
  if (/\b(ph\.?d|doctoral|master'?s|mba|graduate student|post-?doc)\b/i.test(t)) return 'grad-only title';
  if (j.degrees.length && !j.degrees.some(d => /bachelor/i.test(d))) return 'no bachelor eligibility';
  if (/\b(fall|spring|winter|autumn)\b/i.test(t) && !/summer/i.test(t)) return 'not a summer term';
  if (/\b(2026|2028)\b/.test(t) && !/2027/.test(t)) return 'wrong year';
  if (/\b(senior|staff|principal|manager|director)\b/i.test(t) && !/intern/i.test(t)) return 'not an internship';
  if (/skillbridge|veteran|military|clearance required/i.test(t)) return 'special eligibility';
  if (!j.locations.some(l => US.test(l))) return 'not in the US';
  return null;
}
