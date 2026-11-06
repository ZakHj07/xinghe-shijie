// 同一页面会话内做 A/B：先正常截图，再把流沙星河透明度置 0 截图，用来隔离它的贡献。
// usage: node scripts/rivertest.mjs <url> <outA.png> <outB.png> [waitMs]
import fs from 'node:fs';

const [, , url, outA, outB, waitArg] = process.argv;
const waitMs = Number(waitArg || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

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
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ${m.params.args.map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ')}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`[exception] ${d.exception?.description || d.text}`);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++idc;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
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
await sleep(waitMs);

const evalIn = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

const shot = async (file) => {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('[shot]', file);
};

await shot(outA);
const info = await evalIn(`(() => {
  let found = null;
  U.SCENES.galaxy.scene.traverse((o) => {
    if (o.isPoints && o.material && o.material.uniforms && o.material.uniforms.uOpacity && o.geometry.attributes.aAttr) found = o;
  });
  if (!found) return { ok: false };
  window.__river = found;
  found.material.uniforms.uOpacity.value = 0;
  return { ok: true, count: found.geometry.attributes.position.count };
})()`);
console.log('[river]', JSON.stringify(info));
await sleep(700);
await shot(outB);

const after = await evalIn(`(() => { const r = window.__river; if (!r) return null; r.material.uniforms.uOpacity.value = 1; return { restored: true }; })()`);
console.log('[restore]', JSON.stringify(after));
if (logs.length) console.log('[console]\n' + logs.join('\n'));
ws.close();