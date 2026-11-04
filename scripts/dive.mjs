// 专门验证「太阳系 → 地球」的俯冲转场：在进度节点上截图并记录状态
// usage: node dive.mjs <url> <outDir>
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
await sleep(4500);

const evalIn = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
};
const snap = async (name, note) => {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  const info = await evalIn('JSON.stringify({k:U.key,t:+U.T.t.toFixed(3),m:U.T.mode,dive:+(U.st.dive||0).toFixed(3),arrive:+(U.st.earthArrive||1).toFixed(3),dolly:+U.st.dolly.toFixed(3)})');
  console.log('[shot]', name, note || '', info);
};

console.log('scene:', await evalIn('U.key'));
await evalIn('U.st.dolly = 0.999');

// 等转场启动
for (let i = 0; i < 200; i++) {
  if (await evalIn('U.T.active')) break;
  await sleep(50);
}
const t0 = Date.now();
console.log('[start]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur,at:U.T.swapAt})'));

const marks = [
  [0.18, 'dive_18'],
  [0.42, 'dive_42'],
  [0.62, 'dive_62'],
  [0.72, 'dive_72'],
  [0.82, 'dive_82'],
  [0.94, 'dive_94'],
];
let mi = 0;
for (let i = 0; i < 4000; i++) {
  const s = JSON.parse(await evalIn('JSON.stringify({t:U.T.t,a:U.T.active})'));
  if (mi < marks.length && s.t >= marks[mi][0]) {
    await snap(marks[mi][1], `wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
    mi++;
  }
  if (!s.a && mi >= 1) break;
  await sleep(25);
}
await sleep(600);
await snap('dive_end', `wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('[wall total]', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);
