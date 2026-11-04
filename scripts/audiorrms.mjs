// 音频「有没有声音」自检：在 master 后面挂一个 AnalyserNode，量 RMS。
// usage: node audiorrms.mjs <url>
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
  }
};
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
};

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
await sleep(6500);

for (const type of ['mousePressed', 'mouseReleased']) {
  await S('Input.dispatchMouseEvent', { type, x: 800, y: 600, button: 'left', clickCount: 1 });
}
await sleep(1200);

const read = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

// 装一个分析器
await read(`(function(){
  const c = U.audio._ctx, m = U.audio._master;
  if (!c || !m) return 'no ctx';
  window.__an = c.createAnalyser();
  window.__an.fftSize = 2048;
  m.connect(window.__an);
  window.__buf = new Float32Array(window.__an.fftSize);
  return 'ok';
})()`);

const rms = async (label, wait = 900) => {
  await sleep(wait);
  const v = await read(`(function(){
    const a = window.__an, b = window.__buf;
    a.getFloatTimeDomainData(b);
    let s = 0, pk = 0;
    for (let i = 0; i < b.length; i++) { s += b[i]*b[i]; pk = Math.max(pk, Math.abs(b[i])); }
    return JSON.stringify({rms:+Math.sqrt(s/b.length).toFixed(5), peak:+pk.toFixed(4)});
  })()`);
  console.log('[rms]', label, v);
};

await rms('galaxy bed');
await read(`U.applyScene('solar')`);
await rms('solar bed', 2200);
await read(`U.applyScene('earth')`);
await rms('earth bed', 2200);

// 转场音效是否真的冲起来：连续采样，取峰值
console.log('[sfx] 采样 1.6s 内每 100ms 的 RMS');
for (const mode of ['intro', 'galaxyDive', 'dive', 'emerge', 'warp']) {
  await read(`U.audio.transition(${JSON.stringify(mode)}, 1.0, 0.5)`);
  const series = [];
  for (let i = 0; i < 14; i++) {
    await sleep(100);
    const v = await read(`(function(){
      const a=window.__an,b=window.__buf;a.getFloatTimeDomainData(b);
      let s=0;for(let i=0;i<b.length;i++)s+=b[i]*b[i];
      return +Math.sqrt(s/b.length).toFixed(4);
    })()`);
    series.push(v);
  }
  console.log(`  ${mode}: max=${Math.max(...series)} series=${series.join(',')}`);
}

// 静音开关
await read(`(function(){ document.getElementById('audio-btn').click(); return 1; })()`);
await rms('muted', 900);

console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);