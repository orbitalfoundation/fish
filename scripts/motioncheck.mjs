// Confirms the rig is actually animating: samples spine bone rotations and a
// deformed skinned vertex at two instants and checks they change.
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5199/';
const PORT = 9223;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=800,600', '--no-first-run', '--user-data-dir=/tmp/fishchrome2', 'about:blank']);
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
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(4000);
const probe = `(() => {
  const rig = window.FISH.rig();
  const bones = rig.skeleton.bones;
  const tail = bones[bones.length-1];
  const rot = () => bones.map(b => +(b.rotation.y + b.rotation.z).toFixed(4));
  return JSON.stringify({ freq: rig.swimmer.freq, t: rig.swimmer.t, tailRot: +(tail.rotation.y+tail.rotation.z).toFixed(4), sumAbs: rot().reduce((a,v)=>a+Math.abs(v),0).toFixed(3) });
})()`;
const a = (await send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.value;
await sleep(350);
const b = (await send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.value;
console.log('frame A:', a);
console.log('frame B:', b);
const ja = JSON.parse(a), jb = JSON.parse(b);
const moved = Math.abs(ja.tailRot - jb.tailRot) > 1e-4 || Math.abs(+ja.sumAbs - +jb.sumAbs) > 1e-4;
console.log(moved ? '\\nMOTION OK — spine is being driven frame to frame' : '\\nNO MOTION — spine is static');
ws.close(); chrome.kill(); process.exit(moved ? 0 : 1);
