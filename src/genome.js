// Genome ⇄ URL-hash codec.
//
// A fish IS its parameter tree, but almost every shared fish is a species
// preset (or a morph of two) plus a handful of slider tweaks — so instead of
// base64ing the whole tree (~2-3.5k chars), encode the BASELINE plus only the
// leaves that differ from it. Three wire formats, all living in `#fish=`:
//
//   v2 diff     orca~scale=1.4~swim.freq=1.31            (typical: < 100 chars)
//               orca:bluewhale:0.35~pattern.seed=42      (morph baseline a:b:t)
//   v2 full     z:<base64url deflate-raw of the JSON>    (hand-sculpted fallback)
//   legacy      <base64url of the whole JSON tree>       (decode-only, old links)
//
// Every leaf value is a bare number/boolean, or 'percent-encoded-string with a
// leading apostrophe so "1.4" the string can never be confused with the number.
// Floats are rounded to 4 significant digits — below slider resolution — which
// both shortens the URL and hides 0.30000000000000004-style noise; integers
// (seeds, 0xRRGGBB colors) pass through exact.
//
// encodeGenomeSync verifies its own output by decoding it and deep-comparing
// against the source tree, so anything the diff grammar can't express (deleted
// keys, resized fin arrays, exotic values) falls back to the compressed full
// tree instead of producing a corrupt link.

import { makeSpecies, SPECIES } from './species/presets.js';
import { morphParams } from './core/params.js';

const SIG_DIGITS = 4;
// Beyond this, the deflated full tree (~1.5k chars) is the better encoding.
const MAX_DIFF_CHARS = 1400;

const round = (v) =>
  typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)
    ? Number(v.toPrecision(SIG_DIGITS))
    : v;

/** Rebuild the preset tree a genome was diffed against. base = {s} or {s,b,t}. */
function baselineOf(base) {
  if (!SPECIES[base.s]) return null;
  if (base.b == null) return makeSpecies(base.s);
  if (!SPECIES[base.b]) return null;
  return morphParams(makeSpecies(base.s), makeSpecies(base.b), base.t);
}

/**
 * Collect [path, value] pairs where `cur` differs from `base`. Returns false if
 * the difference can't be expressed as leaf assignments (deleted keys, arrays
 * of different length, container/leaf type changes) — caller falls back.
 */
function diffNode(base, cur, path, out) {
  if (cur !== null && typeof cur === 'object') {
    if (base === null || typeof base !== 'object' || Array.isArray(base) !== Array.isArray(cur)) return false;
    if (Array.isArray(cur)) {
      if (base.length !== cur.length) return false;
      for (let i = 0; i < cur.length; i++) {
        if (!diffNode(base[i], cur[i], `${path}.${i}`, out)) return false;
      }
      return true;
    }
    for (const k of Object.keys(base)) if (!(k in cur)) return false;
    for (const k of Object.keys(cur)) {
      if (!diffNode(k in base ? base[k] : undefined, cur[k], path ? `${path}.${k}` : k, out)) return false;
    }
    return true;
  }
  if (base !== null && typeof base === 'object') return false;
  if (round(base) !== round(cur)) out.push([path, round(cur)]);
  return true;
}

function encodeValue(v) {
  if (typeof v === 'string') return "'" + encodeURIComponent(v).replace(/~/g, '%7E');
  return String(v);
}

function decodeValue(raw) {
  if (raw.startsWith("'")) return decodeURIComponent(raw.slice(1));
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`bad genome value: ${raw}`);
  return n;
}

function setPath(root, path, value) {
  const keys = path.split('.');
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (node[k] === null || typeof node[k] !== 'object') {
      node[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
}

function deepEqRounded(a, b) {
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!(k in b) || !deepEqRounded(a[k], b[k])) return false;
    return true;
  }
  return round(a) === round(b) || Object.is(a, b);
}

/**
 * Diff encoding, or null when this fish doesn't compress well against its
 * baseline (then use encodeGenome, which is async and always succeeds).
 * Synchronous so the share button can copy inside the click gesture.
 */
export function encodeGenomeSync(params, base) {
  const baseline = baselineOf(base);
  if (!baseline) return null;
  const pairs = [];
  if (!diffNode(baseline, params, '', pairs)) return null;
  const head = base.b == null ? base.s : `${base.s}:${base.b}:${base.t}`;
  const code = [head, ...pairs.map(([p, v]) => `${p}=${encodeValue(v)}`)].join('~');
  if (code.length > MAX_DIFF_CHARS) return null;
  // Trust nothing: a link that doesn't decode back to this exact fish is worse
  // than a long link.
  try {
    const back = decodeGenomeSync(code);
    if (!deepEqRounded(back.params, params)) return null;
  } catch { return null; }
  return code;
}

/** Best encoding for this fish: compact diff if it round-trips, else z:deflate. */
export async function encodeGenome(params, base) {
  const fast = encodeGenomeSync(params, base);
  if (fast !== null) return fast;
  const rounded = JSON.parse(JSON.stringify(params, (k, v) => round(v)));
  return 'z:' + await deflateB64url(JSON.stringify(rounded));
}

/** Decode v2-diff and legacy-base64 codes. Throws on z: (needs async inflate). */
export function decodeGenomeSync(code) {
  if (code.startsWith('z:')) throw new Error('compressed genome: use decodeGenome()');
  const segs = code.split('~');
  const head = segs[0].split(':');
  if (SPECIES[head[0]]) {
    const base = head.length >= 3 ? { s: head[0], b: head[1], t: Number(head[2]) } : { s: head[0] };
    const params = baselineOf(base);
    if (!params) throw new Error(`unknown genome baseline: ${segs[0]}`);
    for (let i = 1; i < segs.length; i++) {
      if (!segs[i]) continue;
      const eq = segs[i].indexOf('=');
      if (eq < 0) throw new Error(`bad genome pair: ${segs[i]}`);
      setPath(params, segs[i].slice(0, eq), decodeValue(segs[i].slice(eq + 1)));
    }
    return { params, base };
  }
  // Legacy: the entire JSON tree, UTF-8, base64url. Decode-only — links people
  // already shared must keep working.
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  return { params: JSON.parse(decodeURIComponent(escape(atob(b64)))), base: null };
}

/** Decode any genome code, including z:-compressed full trees. */
export async function decodeGenome(code) {
  if (code.startsWith('z:')) {
    return { params: JSON.parse(await inflateB64url(code.slice(2))), base: null };
  }
  return decodeGenomeSync(code);
}

async function deflateB64url(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function inflateB64url(b64url) {
  const bytes = Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
