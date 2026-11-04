// 调试：打开页面 → 执行一段 JS → 等 ms → 打印一段表达式的结果
// usage: node probe.mjs <url> <waitMs> <doJs> <readJs>
const [, , url, waitMs, doJs, readJs] = process.argv;
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
await S('Page.navigate', { url });
const evalIn = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value ?? r.result?.description;
};
for (let i = 0; i < 200; i++) {
  if (await evalIn('!!window.U')) break;
  await sleep(100);
}
console.log('[do]', await evalIn(doJs));
await sleep(Number(waitMs || 1000));
console.log('[read]', await evalIn(readJs));
if (logs.length) console.log(logs.join('\n'));
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);