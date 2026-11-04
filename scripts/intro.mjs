// 验证「加载页 → 银河系」时空隧道进场：按进度节点截图
// usage: node intro.mjs <url> <outDir>
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

const evalIn = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
};

// 等 U 就绪
for (let i = 0; i < 120; i++) {
  if (await evalIn('!!window.U')) break;
  await sleep(100);
}

const snap = async (name, note) => {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  const info = await evalIn('JSON.stringify({k:U.key,t:+U.T.t.toFixed(3),m:U.T.mode,intro:+(U.st.intro??1).toFixed(3),ta:+(U.T.active)})');
  console.log('[shot]', name, note || '', info);
};

// 等场景与资源就绪，再触发进场（资源没加载完时按钮是 disabled，点不动）
for (let i = 0; i < 300; i++) {
  const ok = await evalIn("document.getElementById('enter-btn') && !document.getElementById('enter-btn').disabled && !!U.beginIntro");
  if (ok) break;
  await sleep(120);
}
await evalIn("document.getElementById('enter-btn').click()");
await sleep(80);
if (!(await evalIn('U.T.active'))) await evalIn('U.beginIntro()');
for (let i = 0; i < 200; i++) {
  if (await evalIn('U.T.active')) break;
  await sleep(40);
}
console.log('[start]', await evalIn('JSON.stringify({m:U.T.mode,dur:U.T.dur})'));

const marks = [[0.1, 'intro_10'], [0.28, 'intro_28'], [0.46, 'intro_46'], [0.62, 'intro_62'], [0.8, 'intro_80']];
let mi = 0;
const t0 = Date.now();
for (let i = 0; i < 4000; i++) {
  const s = JSON.parse(await evalIn('JSON.stringify({t:U.T.t,a:U.T.active})'));
  if (mi < marks.length && s.t >= marks[mi][0]) {
    await snap(marks[mi][1], `wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
    mi++;
  }
  if (!s.a && mi >= 1) break;
  await sleep(20);
}
await sleep(700);
await snap('intro_end');
console.log('[errors]', logs.length ? logs.join('\\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);