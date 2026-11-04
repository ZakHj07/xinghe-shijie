// 全流程走查：银河 →(galaxyDive)→ 太阳系 →(dive)→ 地球 →(emerge)→ 银河
// usage: node tour.mjs <url> <outDir>
import fs from 'node:fs';

const [, , url, outDir] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('no devtools');
})();

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let idc = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};
function send(method, params = {}, sessionId) {
  const id = ++idc;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

await S('Page.enable');
await S('Runtime.enable');
await S('Log.enable');
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });

const evalIn = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
};
for (let i = 0; i < 150; i++) {
  if (await evalIn('!!window.U')) break;
  await sleep(100);
}

const shot = async (name) => {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  const info = await evalIn('JSON.stringify({k:U.key,m:U.T.mode,t:+U.T.t.toFixed(2),a:+U.T.active,arr:+(U.st.solarArrive??1).toFixed(2),dive:+(U.st.dive||0).toFixed(2),out:+(U.st.earthOut||0).toFixed(2)})');
  console.log('[shot]', name, info);
};

const waitFor = async (expr, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalIn(expr)) return true;
    await sleep(40);
  }
  return false;
};
const waitIdle = async () => {
  await waitFor('!U.T.active', 60000);
  await sleep(500);
};
const captureAt = async (targets, prefix) => {
  for (const [t, nm] of targets) {
    await waitFor(`U.T.t >= ${t} || !U.T.active`, 60000);
    await shot(`${prefix}_${nm}`);
  }
};

await sleep(800);
await shot('t01_galaxy');

// 1) 银河 → 太阳系
await evalIn('U.st.dolly = 0.999');
await waitFor('U.T.active');
console.log('[mode1]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.2, 'a'], [0.55, 'b'], [0.78, 'c'], [0.94, 'd']], 't02_dive');
await waitIdle();
await shot('t03_solar');

// 2) 太阳系 → 地球
await evalIn('U.st.dolly = 0.999');
await waitFor('U.T.active');
console.log('[mode2]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.45, 'a'], [0.8, 'b']], 't04_dive');
await waitIdle();
await shot('t05_earth');

// 3) 地球 → 银河
await evalIn('U.st.dolly = 0');
await waitFor('U.T.active');
console.log('[mode3]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.15, 'a'], [0.45, 'b'], [0.75, 'c']], 't06_emerge');
await waitIdle();
await shot('t07_back');

console.log('[final]', await evalIn('JSON.stringify({k:U.key,dolly:+U.st.dolly.toFixed(2)})'));
console.log('[errors]', logs.length ? logs.join('\\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);