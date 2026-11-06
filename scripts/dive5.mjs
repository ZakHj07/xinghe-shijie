// 银河→太阳系转场「切镜前后」跳帧截图：node dive4.mjs <url> <outDir>
import fs from 'node:fs';
const [, , url, outDir] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++idc; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });
await sleep(6000);
const evalIn = async (e) => (await S('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
const shot = async (f) => { const r = await S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('[shot]', f); };
console.log('[start]', JSON.stringify(await evalIn(`(U.beginTransition('solar'), {m:U.T.mode, dur:U.T.dur})`)));
for (const target of [0.05, 0.16, 0.28, 0.40, 0.52, 0.62, 0.70, 0.76, 0.79, 0.803, 0.84, 0.90, 1.0]) {
  await evalIn(`U.T.t = ${target}`);
  await sleep(340);
  const st = await evalIn(`({k:U.key, m:U.T.mode, t:+U.T.t.toFixed(3), arr:+(U.st.solarArrive||0).toFixed(2), clean:+(U.st.clean||0).toFixed(2), gd:+(U.st.galaxyDive||0).toFixed(2)})`);
  await shot(`${outDir}/s_${String(Math.round(target * 1000)).padStart(4, '0')}.png`);
  console.log(JSON.stringify(st));
}
if (logs.length) console.log(logs.join('\n')); else console.log('[errors] none');
ws.close();
