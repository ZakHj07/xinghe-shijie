// 摄像头叠加层自检：点「进入宇宙」→ 等手势模型加载 → 读画布尺寸/视频尺寸/状态。
// 需要无头 Edge 带 --use-fake-device-for-media-stream。
// usage: node camtest.mjs <url> [out.png]
const [, , url, outPng] = process.argv;
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
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });
await sleep(5000);

// 等进入按钮可用后真实点击
for (let i = 0; i < 40; i++) {
  const ready = await evaluate(
    `(()=>{const b=document.getElementById('enter-btn');return b && !b.disabled ? 1 : 0})()`,
  );
  if (ready) break;
  await sleep(400);
}
const rect = JSON.parse(
  await evaluate(
    `(()=>{const r=document.getElementById('enter-btn').getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`,
  ),
);
for (const type of ['mousePressed', 'mouseReleased']) {
  await S('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
}
console.log('[click]', JSON.stringify(rect));

// 等手势模型就绪
let status = '';
for (let i = 0; i < 60; i++) {
  status = await evaluate(`document.getElementById('cam-status').textContent`);
  if (/就绪|不可用|失败/.test(status)) break;
  await sleep(500);
}
console.log('[status]', status);

const report = await evaluate(
  `(()=>{
    const o=document.getElementById('cam-overlay');
    const v=document.getElementById('cam');
    const f=document.getElementById('cam-frame')||o.parentElement;
    const cs=getComputedStyle(v);
    return JSON.stringify({
      canvas:[o.width,o.height],
      canvasCss:[Math.round(o.clientWidth),Math.round(o.clientHeight)],
      frame:[Math.round(f.clientWidth),Math.round(f.clientHeight)],
      video:[v.videoWidth,v.videoHeight],
      fit:cs.objectFit,
      dpr:+(window.devicePixelRatio||1),
      ratio:+(o.width/o.height).toFixed(3),
      frameRatio:+(f.clientWidth/f.clientHeight).toFixed(3)
    });
  })()`,
);
console.log('[overlay]', report);

if (outPng) {
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
  console.log('[shot]', outPng);
}

console.log('[errors]', logs.length ? logs.join(' | ') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);