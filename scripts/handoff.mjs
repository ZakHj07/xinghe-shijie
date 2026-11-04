// 交接走查：太阳系 → 地球 的切镜前后逐帧截图，检查有没有尺寸/亮度跳变
// usage: node handoff.mjs <url> <outDir>
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
  if (m.method === 'Runtime.exceptionThrown') {
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
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });

const evalIn = async (e) => {
  const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
};
for (let i = 0; i < 200; i++) {
  if (await evalIn('!!window.U')) break;
  await sleep(100);
}
await sleep(700);

const info = async () =>
  evalIn(
    `JSON.stringify({k:U.key, t:+U.T.t.toFixed(3), m:U.T.mode, arr:+(U.st.earthArrive??1).toFixed(3),
      fov:+U.SCENES.earth.camera.fov.toFixed(1), z:+U.SCENES.earth.camera.position.z.toFixed(3),
      dolly:+U.st.dolly.toFixed(2)})`
  );

await evalIn("U.st.dolly = 0.999");
for (let i = 0; i < 300; i++) {
  if (await evalIn("U.T.active && U.T.mode === 'dive'")) break;
  await sleep(40);
}
console.log('[start]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,at:U.T.swapAt})'));

for (const t of [0.66, 0.70, 0.735, 0.78, 0.86, 1.0]) {
  for (let i = 0; i < 1200; i++) {
    const cur = await evalIn('U.T.t');
    if (!(await evalIn('U.T.active')) || cur >= t) break;
    await sleep(30);
  }
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/h_${String(t).replace('.', '')}.png`, Buffer.from(r.data, 'base64'));
  console.log('[shot]', t, await info());
}
console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);