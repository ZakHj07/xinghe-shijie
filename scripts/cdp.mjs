// Minimal CDP driver: open a page in an already-running headless Edge (--remote-debugging-port=9222),
// collect console output + exceptions, optionally evaluate JS, then screenshot.
// usage: node cdp.mjs <url> <outPng> [waitMs] [evalJs]
const [, , url, out, waitArg, evalJs] = process.argv;
const waitMs = Number(waitArg || 8000);

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
    const txt = m.params.args
      .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
      .join(' ');
    logs.push(`[${m.params.type}] ${txt}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`[exception] ${d.exception?.description || d.text} @${d.url}:${d.lineNumber}`);
  } else if (m.method === 'Log.entryAdded') {
    logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
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
await S('Log.enable');
await S('Network.enable');
await S('Network.setCacheDisabled', { cacheDisabled: true });
await S('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await S('Page.navigate', { url });
await sleep(waitMs);

if (evalJs) {
  try {
    const r = await S('Runtime.evaluate', {
      expression: evalJs,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log('[eval]', JSON.stringify(r.result?.value ?? r.result?.description ?? r));
  } catch (e) {
    console.log('[eval-error]', e.message);
  }
  await sleep(1500);
}

if (out) {
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('[shot]', out);
}

console.log('[console]');
for (const l of logs.slice(-60)) console.log(l);
await send('Target.closeTarget', { targetId });
ws.close();
process.exit(0);
