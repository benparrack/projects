// Save-state <-> compact transport string (JSON with base64 typed arrays, gzipped, base64'd).
// Used to send a keyframe to spectators; works in browsers and Node 18+.

const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function replacer(_k, v) {
  if (ArrayBuffer.isView(v) && v.constructor.name in TYPED) {
    return { $t: v.constructor.name, b: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  }
  return v;
}
function reviver(_k, v) {
  if (v && typeof v === 'object' && typeof v.$t === 'string' && TYPED[v.$t]) {
    const bytes = b64ToBytes(v.b);
    return new TYPED[v.$t](bytes.buffer, 0, bytes.byteLength / TYPED[v.$t].BYTES_PER_ELEMENT);
  }
  return v;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeState(state) {
  const json = new TextEncoder().encode(JSON.stringify(state, replacer));
  return bytesToB64(await pipe(json, new CompressionStream('gzip')));
}

export async function decodeState(str) {
  const json = await pipe(b64ToBytes(str), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json), reviver);
}
