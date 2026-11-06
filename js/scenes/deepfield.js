import * as THREE from 'three';

/**
 * 深空远景：环绕银河系的邻近星系与各类星云。
 * 用程序化贴图 + Sprite，便宜、可控，而且刻意避开银盘所在平面，不会遮住主体。
 */

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** 云气：多层柔光圆叠出的不规则团块（source-over，颜色干净不糊成白） */
function makeNebulaTexture(size, colors, blobs) {
  return canvasTexture(size, (g, s) => {
    for (let i = 0; i < blobs; i++) {
      const r = s * (0.09 + Math.random() * 0.2);
      const a = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.6) * s * 0.24;
      const x = s / 2 + Math.cos(a) * dist;
      const y = s / 2 + Math.sin(a) * dist;
      const c0 = colors[(Math.random() * colors.length) | 0];
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},0.46)`);
      grd.addColorStop(0.42, `rgba(${c0[0]},${c0[1]},${c0[2]},0.20)`);
      grd.addColorStop(1, `rgba(${c0[0]},${c0[1]},${c0[2]},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // 少量亮丝：气体被拉出的纤维感
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const x0 = s * (0.2 + Math.random() * 0.6);
      const y0 = s * (0.2 + Math.random() * 0.6);
      const len = s * (0.1 + Math.random() * 0.28);
      const ang = Math.random() * Math.PI;
      const c0 = colors[(Math.random() * colors.length) | 0];
      const grd = g.createLinearGradient(x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      grd.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},0)`);
      grd.addColorStop(0.5, `rgba(${c0[0]},${c0[1]},${c0[2]},0.09)`);
      grd.addColorStop(1, `rgba(${c0[0]},${c0[1]},${c0[2]},0)`);
      g.strokeStyle = grd;
      g.lineWidth = 1.4 + Math.random() * 3.4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      g.stroke();
    }
  });
}

/** 暗星云：中心厚、边缘散开的暗团，靠 NormalBlending 压暗背后的天光 */
function makeDarkTexture(size, blobs) {
  return canvasTexture(size, (g, s) => {
    for (let i = 0; i < blobs; i++) {
      const r = s * (0.13 + Math.random() * 0.24);
      const a = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.55) * s * 0.2;
      const x = s / 2 + Math.cos(a) * dist;
      const y = s / 2 + Math.sin(a) * dist;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(4,3,8,0.55)');
      grd.addColorStop(0.55, 'rgba(4,3,8,0.26)');
      grd.addColorStop(1, 'rgba(4,3,8,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** 椭圆星系：扁平柔光核 + 外晕 + 稀疏星点 */
function makeEllipticalTexture(size) {
  return canvasTexture(size, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,244,222,0.95)');
    grd.addColorStop(0.16, 'rgba(255,230,190,0.55)');
    grd.addColorStop(0.42, 'rgba(244,212,170,0.18)');
    grd.addColorStop(0.72, 'rgba(228,204,180,0.05)');
    grd.addColorStop(1, 'rgba(228,204,180,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 1.6) * s * 0.3;
      const x = s / 2 + Math.cos(a) * rr * 1.5;
      const y = s / 2 + Math.sin(a) * rr * 0.62;
      g.fillStyle = `rgba(255,246,230,${(0.05 + Math.random() * 0.22).toFixed(3)})`;
      g.fillRect(x, y, 1.2, 1.2);
    }
  });
}

export function createDeepField(opts = {}) {
  const R_S = opts.rScale || 1;
  const W_S = opts.wScale || 1;
  const O_S = opts.opacityScale == null ? 1 : opts.opacityScale;
  const group = new THREE.Group();
  const items = [];
  const rnd = (a, b) => a + Math.random() * (b - a);

  const NEB = {
    emission: makeNebulaTexture(256, [[255, 108, 132], [255, 156, 110], [214, 82, 152]], 22),
    reflection: makeNebulaTexture(256, [[92, 156, 255], [126, 196, 255], [156, 128, 255]], 22),
    mixed: makeNebulaTexture(256, [[128, 112, 255], [232, 98, 156], [96, 186, 224]], 24),
    warm: makeNebulaTexture(256, [[255, 158, 76], [226, 96, 74], [255, 200, 128]], 20),
    dark: makeDarkTexture(256, 16),
    elliptical: makeEllipticalTexture(256),
  };

  function place(tex, o) {
    // depthTest 关掉：远景精灵要画在银河粒子之后，否则会被深度测试整片剔除
    const mat = new THREE.SpriteMaterial({
      map: tex, color: o.color || 0xffffff, transparent: true,
      blending: o.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, opacity: o.opacity, toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    const az = (o.az * Math.PI) / 180;
    const el = (o.el * Math.PI) / 180;
    sp.position.set(
      Math.cos(az) * Math.cos(el) * o.r * R_S,
      Math.sin(el) * o.r * R_S,
      Math.sin(az) * Math.cos(el) * o.r * R_S
    );
    sp.scale.set(o.w * W_S, o.w * (o.squash || 1) * W_S, 1);
    sp.renderOrder = o.order != null ? o.order : -8;
    sp.userData.col0 = new THREE.Color(o.color || 0xffffff);
    sp.material.rotation = o.rot || 0;
    group.add(sp);
    items.push({
      sp, base: o.opacity * O_S, w: o.w * W_S, squash: o.squash || 1,
      spin: o.spin || 0, ph: Math.random() * 6.28,
      pulse: o.pulse || 0, breathe: o.breathe || 0,
    });
    return sp;
  }

  // 布局思路：银河占画面中心，左侧被 HUD 面板挡住，
  // 所以星云分两类 ——「后排大云」放在银河之后（r 很大、很淡，光晕从盘面四周溢出来），
  // 「前景小云」放在画面下方那条空天空带里（el ≈ -25°），不挡主体也不被 UI 盖住。
  const back = [
    { tex: NEB.emission,   az: -18, el: 6,   r: 2400, w: 1300, opacity: 0.34, color: 0xff8fa8, spin: 0.003,  breathe: 0.010 },
    { tex: NEB.reflection, az: 20,  el: -8,  r: 2500, w: 1400, opacity: 0.30, color: 0x8fb8ff, spin: -0.002, breathe: 0.009 },
    { tex: NEB.mixed,      az: 4,   el: 22,  r: 2600, w: 1200, opacity: 0.27, color: 0xb9a6ff, spin: 0.004,  breathe: 0.011 },
    { tex: NEB.warm,       az: -30, el: -16, r: 2350, w: 1150, opacity: 0.25, color: 0xffb48f, spin: 0.003,  breathe: 0.008 },
    { tex: NEB.emission,   az: 34,  el: 14,  r: 2450, w: 1200, opacity: 0.25, color: 0xff9ab4, spin: -0.003, breathe: 0.010 },
  ];
  for (const o of back) place(o.tex, { ...o, squash: 0.72, rot: rnd(-0.3, 0.3), order: -9 });

  // 前景：画面下方的空天空带（y 方向 el -22 ~ -27，避开底部 UI）
  const front = [
    { tex: NEB.emission,   az: -9,  el: -25, r: 760, w: 430, opacity: 0.88, color: 0xff93ad, spin: 0.006,  breathe: 0.018 },
    { tex: NEB.reflection, az: 13,  el: -26, r: 820, w: 200, opacity: 0.46, color: 0x9cc2ff, spin: -0.005, breathe: 0.016 },
    { tex: NEB.mixed,      az: 27,  el: -22, r: 900, w: 360, opacity: 0.62, color: 0xc7b4ff, spin: 0.005,  breathe: 0.014 },
    { tex: NEB.warm,       az: -24, el: -23, r: 880, w: 340, opacity: 0.56, color: 0xffc099, spin: 0.004,  breathe: 0.012 },
  ];
  for (const o of front) place(o.tex, { ...o, squash: 0.7, rot: rnd(-0.4, 0.4), order: -7 });

  // 暗星云：压在前景星云边缘，做出「被尘埃切开」的层次
  place(NEB.dark, { az: -2, el: -24, r: 700, w: 300, opacity: 0.75, squash: 0.42, rot: 0.35, spin: 0.002, dark: true, order: -7 });
  place(NEB.dark, { az: 19, el: -19, r: 740, w: 260, opacity: 0.65, squash: 0.36, rot: -0.25, spin: -0.002, dark: true, order: -7 });

  // 邻近星系：椭圆星系（放在上方与右下角的空档）
  place(NEB.elliptical, { az: -31, el: 24, r: 1500, w: 120, opacity: 0.75, squash: 0.6, spin: 0.0025, order: 1, color: 0xffe8c8 });
  place(NEB.elliptical, { az: 44,  el: -20, r: 1560, w: 96,  opacity: 0.71, squash: 0.76, spin: -0.002, order: 1, color: 0xfff2dc });
  place(NEB.elliptical, { az: 8,   el: 25,  r: 1680, w: 72,  opacity: 0.56, squash: 0.5, spin: 0.003, order: 1, color: 0xf2e6d0 });

  // 恒星形成区：嵌在前景星云里的小亮结，微弱脉冲
  const hii = [
    { az: -7,  el: -24, r: 780, w: 74 },
    { az: 11,  el: -25, r: 840, w: 66 },
    { az: 25,  el: -21, r: 900, w: 78 },
    { az: -22, el: -22, r: 870, w: 62 },
  ];
  for (const o of hii) {
    place(NEB.emission, {
      ...o, color: 0xff8fb0, opacity: 0.70, squash: 0.9, order: 3,
      pulse: rnd(0.55, 1.15), breathe: 0.05, spin: 0.01,
    });
  }

  let t = 0;
  function update(dt, fade = 1, introFade = 1) {
    t += dt;
    for (const it of items) {
      const s = it.sp;
      if (it.spin) s.material.rotation += it.spin * dt;
      if (it.breathe || it.pulse) {
        const b = 1 + Math.sin(t * (0.11 + it.pulse * 0.16) + it.ph) * (it.breathe || 0) * 0.5;
        s.scale.set(it.w * b, it.w * it.squash * b, 1);
      }
      let op = it.base * fade * introFade;
      if (it.pulse) {
        const p = 0.5 + 0.5 * Math.sin(t * (0.7 * it.pulse) + it.ph * 2.1);
        op *= 0.74 + 0.40 * p * p;
      }
      s.material.opacity = op;
    }
  }

  // 行星环境色影响背景：火星偏暖橙、木星偏金棕、冰巨星偏冷蓝
  // 统一色温 + 强制去饱和：源贴图里的纯红/纯蓝会在这里被压成灰蓝的星际尘埃，
  // 只保留一点点色相差异，避免出现「滤镜光斑」那种大面积高饱和色块
  const _tc = new THREE.Color();
  function setTint(color, desat = 0.78) {
    group.traverse((o) => {
      if (!o.isSprite || !o.userData.col0) return;
      const c = o.userData.col0;
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      _tc.setRGB(lum, lum, lum).lerp(c, 1 - desat);
      o.material.color.copy(_tc).multiply(color);
    });
  }

  return { group, update, setTint };
}