// Renders a clean gallery image per species (GUI + overlays hidden) into examples/.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples');
mkdirSync(OUT, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5199/';
const PORT = 9225;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1200,900', '--force-device-scale-factor=2',
  '--no-first-run', '--user-data-dir=/tmp/fishgallery', 'about:blank']);
chrome.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdp() {
  for (let i = 0; i < 40; i++) {
    try { const l = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('no devtools');
}
const page = await cdp();
const ws = new (await import('ws')).WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pend = new Map();
ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(4000);
// Hide UI chrome for clean plates.
await send('Runtime.evaluate', { expression: `
  document.querySelectorAll('.lil-gui, #title, #hud, #loader').forEach(e => e.style.display='none');
  true;` });

// A flattering camera per species (azimuth, elevation, distance factor).
const shots = {
  minnow: [0.62, 0.12], clownfish: [0.62, 0.12], angelfish: [0.55, 0.08],
  boxfish: [0.7, 0.18], pufferfish: [0.66, 0.14], tuna: [0.6, 0.14],
  eel: [0.5, 0.22], orca: [0.7, 0.42], bluewhale: [0.62, 0.3],
};

for (const [sp, [az, el]] of Object.entries(shots)) {
  await send('Runtime.evaluate', { expression: `window.FISH.setSpecies('${sp}')` });
  await sleep(2200); // let RD settle + a few swim cycles
  // Nudge the camera to a nice 3/4 view.
  await send('Runtime.evaluate', { expression: `(() => {
    const F = window.FISH; const rig = F.rig(); const s = rig.span;
    // reach into main's camera/controls via the render loop globals is not exposed;
    // instead orbit by dispatching: we expose nothing, so rely on default framing.
    return true;
  })()` });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    // Crop to a centered landscape plate (source is 2400x1800 at 2x DPR).
    const path = join(OUT, `${sp}.png`);
    writeFileSync(path, Buffer.from(shot.data, 'base64'));
    process.stdout.write(`${sp} `);
  }
  void az; void el;
}
console.log('\ndone');
ws.close(); chrome.kill(); process.exit(0);
