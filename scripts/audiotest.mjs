// 音频自检：用 CDP 派发一次真实鼠标点击（产生用户手势），再检查 AudioContext 是否 running，
// 并跑一遍四条转场音效，确认没有异常、上下文时钟在走。
// usage: node audiotest.mjs <url>
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

await S('Page.enable');
await S('Runtime.enable');
await S('Log.enable');
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url });
await sleep(6500);

// 一次真实点击 → 用户激活
for (const type of ['mousePressed', 'mouseReleased']) {
  await S('Input.dispatchMouseEvent', { type, x: 800, y: 600, button: 'left', clickCount: 1 });
}
await sleep(800);

const evalJs = (expr) => S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const read = async (expr) => {
  const r = await evalJs(expr);
  return r.result?.value;
};

console.log('[before]', await read(`JSON.stringify({run:U.audio.running, state:U.audio._ctx?U.audio._ctx.state:'none'})`));

// 手动把所有四条转场音效各跑一次（时长压缩到 0.8s，避免等太久）
await read(`(function(){
  U.audio.start();
  ['intro','galaxyDive','dive','emerge','warp'].forEach((m,i)=>setTimeout(()=>U.audio.transition(m,0.8,0.5), i*220));
  return 'fired';
})()`);
await sleep(1800);

const stats = await read(`(function(){
  const c = U.audio._ctx; if(!c) return 'no ctx';
  return JSON.stringify({
    run: U.audio.running,
    state: c.state,
    t: +c.currentTime.toFixed(2),
    sr: c.sampleRate,
    scene: U.audio.scene,
    muted: U.audio.muted,
    bars: document.querySelectorAll('#audio-btn .bar').length,
    btn: !!document.getElementById('audio-btn'),
  });
})()`);
console.log('[stats]', stats);

console.log('[errors]', logs.length ? logs.join('\n') : 'none');
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);