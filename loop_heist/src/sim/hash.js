// FNV-1a over the canonical JSON of the state. State objects are always built in
// the same key order, so equal states give equal hashes.
export function hashState(S) {
  const s = JSON.stringify(S);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
