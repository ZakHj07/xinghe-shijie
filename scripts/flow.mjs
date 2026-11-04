// Drive the full user journey and capture screenshots at key moments.
// usage: node flow.mjs <url> <outDir>
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
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push('[log.error] ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
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
await sleep(4000);

async function evalIn(expr) {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
}
async function shot(name) {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('[shot]', name, 'key=', await evalIn('window.U && U.key'), 'dolly=', await evalIn('window.U && +U.st.dolly.toFixed(3)'));
}

console.log('scene:', await evalIn('window.U && U.key'));
await shot('01_galaxy');

// 放大 → 曲速 → 太阳系
await evalIn('U.st.dolly = 0.999');
await sleep(1500);
await shot('02_warp_to_solar');
await sleep(6000);
await shot('03_solar');

// 太阳系里转动视角
await evalIn('U.st.yaw = 1.1; U.st.pitch = 0.85');
await sleep(900);
await shot('04_solar_orbit_view');

// 放大 → 曲速 → 地球
await evalIn('U.st.dolly = 0.999');
await sleep(1500);
await shot('05_warp_to_earth');
await sleep(6000);
await shot('06_earth');

// 地球旋转
await evalIn('U.st.yaw = 1.6; U.st.pitch = -0.5');
await sleep(900);
await shot('07_earth_rotated');

// 缩小 → 回银河
await evalIn('U.st.dolly = 0');
await sleep(1500);
await shot('08_warp_back');
await sleep(6000);
await shot('09_back_galaxy');

console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);
