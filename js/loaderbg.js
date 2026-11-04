// 加载页背景的动态层：Canvas 2D 绘制
//   1) 会闪烁的恒星（含少量带十字衍射的亮星）—— 呼应「恒星闪烁」的需求
//   2) 缓慢上浮的星尘 —— 给静止照片一点呼吸感
// 星云本体由 CSS 做极慢推拉 + 局部暖光呼吸（见 style.css 的 nebulaDrift / nebulaPulse）。
export function initLoaderBg() {
  const canvas = document.getElementById('loader-dust');
  const wrap = document.querySelector('.loader-bg');
  if (!canvas || !wrap) return { stop() {} };

  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  let raf = 0;
  let running = true;
  let last = 0;
  const stars = [];
  const dust = [];

  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---- 柔光精灵（星尘用） ---- */
  const softSprite = document.createElement('canvas');
  {
    const SS = 64;
    softSprite.width = softSprite.height = SS;
    const sc = softSprite.getContext('2d');
    const g = sc.createRadialGradient(SS / 2, SS / 2, 0, SS / 2, SS / 2, SS / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.26, 'rgba(214,232,255,.55)');
    g.addColorStop(1, 'rgba(180,210,255,0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, SS, SS);
  }

  /* ---- 锐利星点精灵（恒星用） ---- */
  const starSprite = document.createElement('canvas');
  {
    const SS = 32;
    starSprite.width = starSprite.height = SS;
    const sc = starSprite.getContext('2d');
    const g = sc.createRadialGradient(SS / 2, SS / 2, 0, SS / 2, SS / 2, SS / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,.92)');
    g.addColorStop(0.45, 'rgba(190,220,255,.30)');
    g.addColorStop(1, 'rgba(150,190,255,0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, SS, SS);
  }

  function makeStar() {
    const big = Math.random() < 0.08;
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: big ? rand(1.5, 2.5) : rand(0.45, 1.25),
      base: big ? rand(0.65, 1) : rand(0.22, 0.7),
      sp: rand(0.5, 2.6),
      phase: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.3,
      flare: big,
      flareLen: big ? rand(9, 22) : 0,
      sp2: rand(0.05, 0.16), // 极缓慢的视差漂移
    };
  }

  function makeDust(spread) {
    const depth = Math.random();
    return {
      x: Math.random() * w,
      y: spread ? Math.random() * h : h + rand(4, 90),
      z: depth,
      r: 0.7 + depth * 2.4,
      vy: -(2 + depth * 10) / 60,
      sway: rand(0.25, 1.1),
      phase: Math.random() * Math.PI * 2,
      a: (0.08 + depth * 0.42) * rand(0.55, 1),
    };
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    w = Math.max(rect.width, 1);
    h = Math.max(rect.height, 1);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const starCount = Math.min(260, Math.round((w * h) / 7600));
    while (stars.length < starCount) stars.push(makeStar());
    stars.length = starCount;

    const dustCount = Math.min(120, Math.round((w * h) / 18000));
    while (dust.length < dustCount) dust.push(makeDust(true));
    dust.length = dustCount;
  }

  function draw(t) {
    const dt = Math.min((t - last) / 1000, 0.05) || 0.016;
    last = t;
    const tt = t / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    /* ---- 恒星：闪烁 + 十字衍射 ---- */
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(tt * s.sp + s.phase);
      const a = s.base * (0.35 + 0.65 * tw);
      const x = s.x + Math.sin(tt * s.sp2 + s.phase) * 6;
      const y = s.y + Math.cos(tt * s.sp2 * 0.8 + s.phase) * 4;
      const sz = s.r * 9;
      ctx.globalAlpha = a;
      ctx.drawImage(starSprite, x - sz / 2, y - sz / 2, sz, sz);

      if (s.flare) {
        const L = s.flareLen * (0.55 + 0.45 * tw);
        const g = ctx.createLinearGradient(x - L, y, x + L, y);
        g.addColorStop(0, 'rgba(180,215,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${0.55 * a})`);
        g.addColorStop(1, 'rgba(180,215,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - L, y - 0.5, L * 2, 1);
        const g2 = ctx.createLinearGradient(x, y - L, x, y + L);
        g2.addColorStop(0, 'rgba(180,215,255,0)');
        g2.addColorStop(0.5, `rgba(255,255,255,${0.42 * a})`);
        g2.addColorStop(1, 'rgba(180,215,255,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(x - 0.5, y - L, 1, L * 2);
      }
    }

    /* ---- 星尘：向上飘 ---- */
    for (const p of dust) {
      p.y += p.vy * dt * 60;
      p.phase += dt * p.sway;
      const x = p.x + Math.sin(p.phase) * (6 + p.z * 14);
      if (p.y < -30) Object.assign(p, makeDust(false));

      const twinkle = 0.7 + 0.3 * Math.sin(p.phase * 1.7 + p.x);
      ctx.globalAlpha = p.a * twinkle * 0.85;
      const s = p.r * 7;
      ctx.drawImage(softSprite, x - s / 2, p.y - s / 2, s, s);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(t) {
    if (!running) return;
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  resize();
  if (reduce) {
    draw(0);
  } else {
    raf = requestAnimationFrame(loop);
  }

  const onResize = () => {
    resize();
    if (reduce) draw(0);
  };
  window.addEventListener('resize', onResize);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    },
  };
}