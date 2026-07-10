// Mobile-layout + genome-URL round-trip check.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5173/';
const PORT = 9226;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=400,820', '--no-first-run', '--user-data-dir=/tmp/fishmobile', 'about:blank']);
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
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 820, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(4000);

// Genome round-trip: switch to tuna, grab its code, load it fresh, confirm it restores.
await evalJs(`window.FISH.setSpecies('tuna')`);
await sleep(800);
const code = await evalJs(`window.FISH.encode()`);
await send('Page.navigate', { url: `${URL}#fish=${code}` });
await sleep(3500);
const restored = await evalJs(`window.FISH.params.id`);
console.log(`genome round-trip: encoded tuna -> reloaded species = "${restored}"  ${restored === 'tuna' ? 'OK' : 'FAIL'}  (code ${code.length} chars)`);

// Mobile layout: open the panel, screenshot — the fish should sit above the sheet.
await evalJs(`document.getElementById('panel-tab').click(); true`);
await sleep(700);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) { writeFileSync('/tmp/fish_mobile.png', Buffer.from(shot.data, 'base64')); console.log('saved /tmp/fish_mobile.png (panel open)'); }

ws.close(); chrome.kill(); process.exit(0);
