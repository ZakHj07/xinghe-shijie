/* ------------------------------------------------------------------
   背景音乐：全部用 Web Audio 现场合成，不加载任何音频文件。
   - 三个场景各有一条「铺垫床」（和声垫 + 次低频 + 空气声 + 钟琴点缀），切换场景时交叉淡入淡出
   - 四种转场各有一套音效（进场隧道 / 俯冲太阳系 / 俯冲地球 / 升空回银河 / 兜底跃迁）
   - 浏览器要求用户手势之后才能出声，所以第一次点击/按键时才真正启动
   ------------------------------------------------------------------ */

const SCENE_MUSIC = {
  galaxy: {
    // Em9 → Cmaj7 → G6 → Dsus2，每个和弦 14 秒
    chords: [
      [82.41, 123.47, 196.0, 293.66, 369.99],
      [65.41, 130.81, 196.0, 246.94, 329.63],
      [98.0, 146.83, 196.0, 293.66, 392.0],
      [73.42, 110.0, 146.83, 220.0, 329.63],
    ],
    sub: 41.2,
    cutoff: 720,
    air: 900,
    bells: [587.33, 659.25, 783.99, 880.0, 1174.66],
    bellGap: [3800, 7200],
    level: 0.85,
  },
  solar: {
    // Dmaj9 → Bm7 → Gmaj7 → A sus，暖一些、亮一些
    chords: [
      [73.42, 110.0, 146.83, 185.0, 220.0],
      [61.74, 123.47, 185.0, 246.94, 293.66],
      [98.0, 146.83, 196.0, 246.94, 392.0],
      [55.0, 110.0, 164.81, 220.0, 329.63],
    ],
    sub: 36.7,
    cutoff: 1180,
    air: 1400,
    bells: [440.0, 587.33, 739.99, 880.0, 1108.73],
    bellGap: [2600, 5200],
    level: 0.9,
  },
  earth: {
    // Cmaj9 → Am9 → Fmaj7 → G6，轻、透、留白多
    chords: [
      [65.41, 98.0, 164.81, 246.94, 293.66],
      [55.0, 110.0, 164.81, 261.63, 329.63],
      [87.31, 130.81, 174.61, 261.63, 349.23],
      [98.0, 146.83, 196.0, 293.66, 392.0],
    ],
    sub: 32.7,
    cutoff: 1650,
    air: 2100,
    bells: [523.25, 659.25, 783.99, 1046.5, 1318.51],
    bellGap: [4200, 8200],
    level: 0.72,
  },
};

const CHORD_SECONDS = 14;
const CROSSFADE = 1.6;

export function createAudio() {
  let ctx = null;
  let master = null;
  let revSend = null;
  let duck = null;
  let beds = {};
  let current = 'galaxy';
  let started = false;
  let muted = false;
  let chordTimer = null;
  let bellTimer = null;
  let noiseBuf = null;

  /* ---------------- 基础节点 ---------------- */
  function makeNoise() {
    if (!noiseBuf) {
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  function makeReverb() {
    const len = Math.floor(ctx.sampleRate * 3.6);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - t * 0.2);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    conv.connect(g);
    return { input: conv, out: g };
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    master.connect(comp);
    comp.connect(ctx.destination);

    const rev = makeReverb();
    revSend = ctx.createGain();
    revSend.gain.value = 0.9;
    revSend.connect(rev.input);
    rev.out.connect(master);

    // 转场时把「音乐床」短暂让开一点，让音效站到前面（reverb 尾巴不跟着压）
    duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(master);

    Object.keys(SCENE_MUSIC).forEach((k) => {
      beds[k] = makeBed(k, SCENE_MUSIC[k]);
    });
    // 初始状态：只有当前场景那条床是「准备响」的，其余静音
    Object.keys(beds).forEach((k) => {
      beds[k].out.gain.value = 0;
    });
  }

  function makeBed(key, cfg) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(duck);
    out.connect(revSend);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cfg.cutoff;
    lp.Q.value = 0.55;
    lp.connect(out);

    // 和声垫：低两条用正弦（干净的低频），上面用三角波（带一点泛音）
    const voices = cfg.chords[0].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i % 2 ? 6 : -6);
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.30 : i < 2 ? 0.16 : 0.10;
      o.connect(g);
      g.connect(lp);
      o.start();
      return o;
    });

    // 次低频
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = cfg.sub;
    const subG = ctx.createGain();
    subG.gain.value = 0.20;
    sub.connect(subG);
    subG.connect(out);
    sub.start();

    // 极轻的空气声
    const air = makeNoise();
    const af = ctx.createBiquadFilter();
    af.type = 'bandpass';
    af.frequency.value = cfg.air;
    af.Q.value = 0.8;
    const ag = ctx.createGain();
    ag.gain.value = 0.035;
    air.connect(af);
    af.connect(ag);
    ag.connect(out);
    air.start();

    // 滤器缓慢呼吸
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.032;
    const lfoG = ctx.createGain();
    lfoG.gain.value = cfg.cutoff * 0.32;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start();

    return { out, lp, voices, chord: 0, cfg };
  }

  /* ---------------- 和弦推进 / 钟琴 ---------------- */
  function stepChord() {
    Object.keys(beds).forEach((k) => {
      const b = beds[k];
      const chords = b.cfg.chords;
      b.chord = (b.chord + 1) % chords.length;
      const notes = chords[b.chord];
      const t = ctx.currentTime;
      b.voices.forEach((o, i) => {
        if (notes[i] == null) return;
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(notes[i], t + 3.2);
      });
    });
  }

  function scheduleBell() {
    const cfg = SCENE_MUSIC[current];
    if (!cfg) return;
    const [lo, hi] = cfg.bellGap;
    const wait = lo + Math.random() * (hi - lo);
    bellTimer = setTimeout(() => {
      if (started && ctx && ctx.state === 'running') ping();
      scheduleBell();
    }, wait);
  }

  function ping() {
    const cfg = SCENE_MUSIC[current];
    if (!cfg) return;
    const f = cfg.bells[Math.floor(Math.random() * cfg.bells.length)];
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.005;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(master);
    g.connect(revSend);
    o.start(t);
    o2.start(t);
    o.stop(t + 3.6);
    o2.stop(t + 3.6);
  }

  /* ---------------- 转场音效 ---------------- */
  function noiseSweep(dur, f0, f1, peak, q = 1.4) {
    const t = ctx.currentTime;
    const src = makeNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    g.connect(revSend);
    src.start(t);
    src.stop(t + dur * 1.1);
  }

  function toneRise(dur, f0, f1, peak, type = 'triangle') {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.82);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.02);
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    g.connect(revSend);
    o.start(t);
    o.stop(t + dur * 1.05);
  }

  function boom(at, peak = 0.30) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g);
    g.connect(master);
    g.connect(revSend);
    o.start(t);
    o.stop(t + 1.6);
  }

  function shimmer(dur, notes, peak = 0.05) {
    const t = ctx.currentTime;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = t + i * 0.08;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g);
      g.connect(master);
      g.connect(revSend);
      o.start(at);
      o.stop(at + dur + 0.1);
    });
  }

  /* ---------------- 对外接口 ---------------- */
  function setScene(key) {
    current = key;
    if (!ctx) return;
    const t = ctx.currentTime;
    Object.keys(beds).forEach((k) => {
      const g = beds[k].out.gain;
      const target = k === key ? SCENE_MUSIC[k].level * 0.34 : 0;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target, t + CROSSFADE);
    });
  }

  function transition(mode, dur, swapAt) {
    if (!ctx || !started) return;
    const hit = (swapAt || 0.5) * dur;
    const t0 = ctx.currentTime;

    // 让音乐床先让开，音效才听得清
    if (duck) {
      const d = duck.gain;
      d.cancelScheduledValues(t0);
      d.setValueAtTime(d.value, t0);
      d.linearRampToValueAtTime(0.55, t0 + 0.18);
      d.linearRampToValueAtTime(1, t0 + Math.max(0.9, dur * 1.05));
    }

    if (mode === 'intro') {
      // 隧道：噪声扫频由宽到窄 + 低频爬升，穿出隧道那一刻一记闷响
      noiseSweep(dur * 0.95, 260, 3600, 0.20, 1.1);
      toneRise(dur * 0.9, 70, 520, 0.062);
      boom(hit, 0.32);
      shimmer(1.6, [1046.5, 1567.98, 2093.0], 0.05);
    } else if (mode === 'galaxyDive') {
      // 朝着猎户臂加速俯冲：更低更长的一口气，收尾更闷
      noiseSweep(dur * 1.0, 180, 2600, 0.19, 0.9);
      toneRise(dur, 55, 330, 0.068);
      boom(hit, 0.30);
    } else if (mode === 'dive') {
      // 贴近地球：柔和的「接近感」，不要重击，免得打断无缝交接
      noiseSweep(dur * 1.0, 900, 220, 0.11, 0.8);
      shimmer(dur * 0.8, [523.25, 783.99], 0.042);
      boom(hit, 0.16);
    } else if (mode === 'emerge') {
      // 升空：反向——从低到高的气流 + 一串上扬的铃
      noiseSweep(dur * 1.0, 200, 2400, 0.15, 0.9);
      shimmer(dur * 1.1, [783.99, 1046.5, 1318.51, 1567.98], 0.05);
      toneRise(dur, 90, 420, 0.05);
    } else if (mode === 'galaxyEarth') {
      // 从银盘一路坠向一颗行星：低沉的俯冲 + 落下时一记闷响与几点亮光
      noiseSweep(dur * 1.05, 150, 2900, 0.19, 0.86);
      toneRise(dur, 52, 300, 0.062);
      boom(hit, 0.30);
      shimmer(dur * 0.5, [659.25, 987.77, 1318.51], 0.042);
    } else if (mode === 'earthSolar') {
      // 反向拉开：气流由近及远，铃音往上走
      noiseSweep(dur * 1.0, 240, 2500, 0.15, 0.92);
      shimmer(dur * 1.0, [587.33, 880, 1174.66, 1567.98], 0.046);
      toneRise(dur, 80, 380, 0.046);
    } else if (mode === 'solarGalaxy') {
      // 整片太阳系缩成一颗粒：一次缓慢的下沉，然后银河铺开
      noiseSweep(dur * 1.05, 520, 150, 0.15, 0.85);
      toneRise(dur, 120, 48, 0.055);
      boom(hit, 0.28);
      shimmer(dur * 0.9, [523.25, 783.99, 1046.5], 0.045);
    } else {
      noiseSweep(dur * 0.9, 300, 2800, 0.18, 1.2);
      boom(hit, 0.24);
    }
  }

  async function start() {
    if (!ctx) build();
    // 不让 resume() 挡住后面的初始化：无手势/无输出设备时它可能一直不 settle
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true;
    setScene(current);
    chordTimer = setInterval(stepChord, CHORD_SECONDS * 1000);
    scheduleBell();
    setTimeout(() => { if (started) ping(); }, 900);
  }

  function toggle() {
    muted = !muted;
    if (master) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.5, t + 0.35);
    }
    return muted;
  }

  return {
    start,
    setScene,
    transition,
    toggle,
    get muted() { return muted; },
    get running() { return started && !!ctx && ctx.state === 'running'; },
    get scene() { return current; },
    // 调试用
    get _ctx() { return ctx; },
    get _master() { return master; },
  };
}