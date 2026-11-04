// 三条「直接跳」转场走查：银河→地球 / 地球→太阳系 / 太阳系→银河
// usage: node tour2.mjs <url> <outDir>
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
  const info = await evalIn(
    'JSON.stringify({k:U.key,m:U.T.mode,t:+U.T.t.toFixed(2),arr:+(U.st.solarArrive??1).toFixed(2),' +
    'dive:+(U.st.dive||0).toFixed(2),gd:+(U.st.galaxyDive||0).toFixed(2),out:+(U.st.earthOut||0).toFixed(2),' +
    'in:+(U.st.intro??1).toFixed(2)})'
  );
  console.log('[shot]', name, info);
};

const waitFor = async (expr, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalIn(expr)) return true;
    await sleep(40);
  }
  return false;
};
const captureAt = async (targets, prefix) => {
  for (const [t, nm] of targets) {
    await waitFor(`U.T.t >= ${t} || !U.T.active`);
    await shot(`${prefix}_${nm}`);
  }
};
const waitIdle = async () => {
  await waitFor('!U.T.active', 90000);
  await sleep(600);
};

await sleep(1000);
await shot('g01_start');

// 1) 银河 → 地球
await evalIn("U.beginTransition('earth')");
await waitFor('U.T.active');
console.log('[mode1]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.18, 'a'], [0.40, 'b'], [0.58, 'c'], [0.78, 'd'], [0.95, 'e']], 'g02_galaxyEarth');
await waitIdle();
await shot('g03_earth');

// 2) 地球 → 太阳系
await evalIn("U.beginTransition('solar')");
await waitFor('U.T.active');
console.log('[mode2]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.20, 'a'], [0.46, 'b'], [0.66, 'c'], [0.88, 'd']], 'g04_earthSolar');
await waitIdle();
await shot('g05_solar');

// 3) 太阳系 → 银河
await evalIn("U.beginTransition('galaxy')");
await waitFor('U.T.active');
console.log('[mode3]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,to:U.T.to})'));
await captureAt([[0.20, 'a'], [0.48, 'b'], [0.70, 'c'], [0.90, 'd']], 'g06_solarGalaxy');
await waitIdle();
await shot('g07_back');

console.log('[final]', await evalIn('JSON.stringify({k:U.key,dolly:+U.st.dolly.toFixed(2)})'));
console.log('[errors]', logs.length ? logs.join(' | ') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);