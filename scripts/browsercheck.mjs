// Drives headless Chrome via the DevTools protocol (no puppeteer needed) to load
// the app, collect console + page errors, and screenshot each species.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5199/';
const PORT = 9222;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/fishchrome', 'about:blank',
]);
chrome.stderr.on('data', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome devtools never came up');
}

async function main() {
  const page = await cdp();
  const ws = new (await import('ws')).WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push('[EXCEPTION] ' + (e.exception?.description || e.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      logs.push('[LOG.error] ' + m.params.entry.text);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4000); // boot + RD settle

  const glInfo = await send('Runtime.evaluate', {
    expression: `(() => {
      const c = document.querySelector('canvas');
      const gl = c && c.getContext('webgl2');
      return JSON.stringify({
        hasCanvas: !!c, w: c?.width, h: c?.height,
        webgl2: !!gl,
        renderer: gl ? gl.getParameter(gl.getParameter ? 0x1F01 : 0) : null,
        species: window.FISH?.params?.id,
        freq: window.FISH?.rig()?.swimmer?.freq,
        loader: !!document.getElementById('loader'),
      });
    })()`, returnByValue: true,
  });
  console.log('GL/state:', glInfo.result.value);

  // Cycle species and screenshot.
  const species = ['minnow', 'clownfish', 'angelfish', 'boxfish', 'pufferfish', 'tuna', 'eel', 'orca', 'bluewhale'];
  for (const sp of species) {
    await send('Runtime.evaluate', { expression: `window.FISH.setSpecies('${sp}')` });
    await sleep(1500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) writeFileSync(`/tmp/fish_${sp}.png`, Buffer.from(shot.data, 'base64'));
    process.stdout.write(`shot ${sp} `);
  }
  console.log('\n\n--- console (last 40) ---');
  console.log(logs.slice(-40).join('\n') || '(clean)');

  ws.close();
  chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
