// 全屏按钮自检：用 CDP 派发真实鼠标点击（满足用户激活要求），读全屏状态与按钮状态。
// usage: node fstest.mjs <url>
const [, , url] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('devtools endpoint not reachable');
}

const ver = await getVersion();
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
    const d = m.params.exceptionDetails;
    logs.push(`[exception] ${d.exception?.description || d.text}`);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push(`[error] ${m.params.entry.text}`);
  }
};
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

const evaluate = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

await S('Page.enable');
await S('Runtime.enable');
await S('Log.enable');
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });
await sleep(6000);

const rect = await evaluate(
  `(()=>{const r=document.getElementById('fs-btn').getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`,
);
const { x, y } = JSON.parse(rect);
console.log('[rect]', rect);

const state = () =>
  evaluate(
    `JSON.stringify({fs:!!document.fullscreenElement,
      el:document.fullscreenElement?document.fullscreenElement.tagName:null,
      cls:document.getElementById('fs-btn').className,
      aria:document.getElementById('fs-btn').getAttribute('aria-pressed'),
      title:document.getElementById('fs-btn').title})`,
  );

const click = async () => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};

console.log('[before]', await state());
await click();
await sleep(900);
console.log('[after click]', await state());
console.log('[icons]', await evaluate(
  `JSON.stringify({enter:getComputedStyle(document.querySelector('.fs-enter')).display,
    exit:getComputedStyle(document.querySelector('.fs-exit')).display})`,
));
if (process.argv[3]) {
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[3], Buffer.from(shot.data, 'base64'));
  console.log('[shot]', process.argv[3]);
}

await click();
await sleep(900);
console.log('[after click 2]', await state());

console.log('[errors]', logs.length ? logs.join(' | ') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);