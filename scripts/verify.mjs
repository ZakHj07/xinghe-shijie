// 状态机回归：太阳系 → 地球（俯冲）→ 银河系（跃迁）是否都能走通
// usage: node verify.mjs <url>
const [, , url] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:9222/json/version'); if (r.ok) return await r.json(); } catch (_) {}
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++idc;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable');
await S('Runtime.enable');
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });
await sleep(4500);
const ev = async (e) => (await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const waitActive = async (limitMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await ev('U.T.active')) return true;
    await sleep(120);
  }
  return false;
};
const waitIdle = async (limitMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (!(await ev('U.T.active'))) return true;
    await sleep(120);
  }
  return false;
};
console.log('start:', await ev('JSON.stringify({k:U.key})'));
await ev('U.st.dolly = 0.999');
console.log('active:', await waitActive(30000));
console.log('dive started:', await ev('JSON.stringify({m:U.T.mode,dur:U.T.dur})'));
console.log('idle:', await waitIdle(60000));
console.log('after dive:', await ev('JSON.stringify({k:U.key,dolly:+U.st.dolly.toFixed(2),arrive:+U.st.earthArrive.toFixed(2),dive:U.st.dive,hud:document.getElementById("hud-title").textContent})'));
await ev('U.st.dolly = 0');
console.log('active:', await waitActive(30000));
console.log('back transition:', await ev('JSON.stringify({m:U.T.mode,dur:U.T.dur})'));
console.log('idle:', await waitIdle(60000));
console.log('after back:', await ev('JSON.stringify({k:U.key,dolly:+U.st.dolly.toFixed(2),hud:document.getElementById("hud-title").textContent})'));
console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);
