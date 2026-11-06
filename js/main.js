import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { createGalaxy } from './scenes/galaxy.js';
import { createSolar } from './scenes/solar.js';
import { createEarth } from './scenes/earth.js';
import { createHandTracker } from './gestures.js';
import { initLoaderBg } from './loaderbg.js';
import { createAudio } from './audio.js';
import { makeSharpenPass } from './sharpen.js';
import { clamp, lerp, smoothstep } from './util.js';

/* =========================================================
   基础
   ========================================================= */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
/* 分辨率自适应：先按设备像素比开满（上限 1.75，4K 屏也不至于把显卡压死），
   运行中按帧率回落 / 回升，见 tick() 里的 LOD 控制 */
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
const QUALITY_FLOOR = 0.72;
/* 上限 1.35 允许「超采样」：1x 屏上也按 1.35 倍渲染再交给浏览器下采样，
   边缘和星点会明显更实，比单纯抗锯齿更接近截图里的清晰度 */
const QUALITY_CEIL = 1.35;
const LOD_ENABLED = !/[?&]nolod/.test(location.search);
let qualityScale = 1;
let dprNow = MAX_DPR;
renderer.setPixelRatio(dprNow);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* =========================================================
   资源加载
   ========================================================= */
const TEX_PATHS = {
  earthDay: 'assets/textures/2_no_clouds_4k.jpg',
  earthNight: 'assets/textures/earth_night_lights.png',
  earthWater: 'assets/textures/water_4k.png',
  earthClouds: 'assets/textures/fair_clouds_4k.png',
  mercury: 'assets/textures/2k_mercury.jpg',
  venus: 'assets/textures/2k_venus_surface.jpg',
  earth: 'assets/textures/2_no_clouds_4k.jpg',
  mars: 'assets/textures/2k_mars.jpg',
  jupiter: 'assets/textures/2k_jupiter.jpg',
  saturn: 'assets/textures/2k_saturn.jpg',
  ring: 'assets/textures/2k_saturn_ring_alpha.png',
  uranus: 'assets/textures/2k_uranus.jpg',
  neptune: 'assets/textures/2k_neptune.jpg',
  moon: 'assets/textures/2k_moon.jpg',
  sun: 'assets/textures/2k_sun.jpg',
};

const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const tex = {};
const maxAniso = renderer.capabilities.getMaxAnisotropy();

for (const [key, path] of Object.entries(TEX_PATHS)) {
  const t = loader.load(path);
  t.colorSpace = key === 'earthWater' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (key === 'earthWater') t.anisotropy = 1;
  else t.anisotropy = Math.min(16, maxAniso);
  tex[key] = t;
}

const loadFill = document.getElementById('load-fill');
const loadStatus = document.getElementById('load-status');
const enterBtn = document.getElementById('enter-btn');
const loaderEl = document.getElementById('loader');

// 加载页背景（创生之柱 + 浮尘），进入宇宙后就停掉，省电
const loaderBg = initLoaderBg();
function hideLoader() {
  loaderEl.classList.add('hide');
  loaderBg.stop();
}

// 背景音乐（Web Audio 现场合成，见 js/audio.js）
const audio = createAudio();
const audioBtn = document.getElementById('audio-btn');
if (audioBtn) {
  audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.start();
    const m = audio.toggle();
    audioBtn.classList.toggle('is-muted', m);
    audioBtn.setAttribute('aria-pressed', String(!m));
    audioBtn.title = m ? '背景音乐：关' : '背景音乐：开';
  });
}
// 全屏开关（放在音乐按钮上方）
const fsBtn = document.getElementById('fs-btn');
if (fsBtn) {
  const syncFs = () => {
    const on = !!document.fullscreenElement;
    fsBtn.classList.toggle('is-full', on);
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? '退出全屏' : '全屏显示');
    fsBtn.title = on ? '退出全屏（F）' : '全屏显示（F）';
  };
  const toggleFs = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      }
    } catch (err) {
      // 被浏览器策略拒绝（如嵌入 iframe 未授权）时保持原状，不弹错
    }
    syncFs();
  };
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFs();
  });
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFs();
    }
  });
  syncFs();
}
// 浏览器要求先有用户手势才能出声：任何一次点击/按键都顺手把音乐唤起来
function nudgeAudio() {
  audio.start();
  if (audio.running) {
    window.removeEventListener('pointerdown', nudgeAudio);
    window.removeEventListener('keydown', nudgeAudio);
  }
}
window.addEventListener('pointerdown', nudgeAudio);
window.addEventListener('keydown', nudgeAudio);

let loadPct = 0;
manager.onProgress = (_url, loaded, total) => {
  loadPct = Math.round((loaded / total) * 100);
  loadFill.style.width = loadPct + '%';
  loadStatus.textContent = `加载资源 ${loadPct}%`;
};
manager.onLoad = () => {
  loadPct = 100;
  loadFill.style.width = '100%';
  loadStatus.textContent = '星图已就绪';
  enterBtn.disabled = false;
};
manager.onError = (url) => {
  console.warn('资源加载失败', url);
  enterBtn.disabled = false;
};

/* =========================================================
   场景
   ========================================================= */
const pr = renderer.getPixelRatio();
const galaxy = createGalaxy(pr);
const solar = createSolar(pr, tex);
const earth = createEarth(pr, tex);

const SCENES = { galaxy, solar, earth };
let currentKey = 'galaxy';
let active = SCENES.galaxy;

/* ---------------- 后期 ---------------- */
const composer = new EffectComposer(renderer);
/* WebGL2 下给整个后期链开 4x MSAA：Bloom/Output 都在同一个多采样缓冲里走，
   星球边缘、土星环、轨道线不再有锯齿 */
const MSAA_MAX = Math.min(4, renderer.capabilities.maxSamples || 4);
composer.renderTarget1.samples = MSAA_MAX;
composer.renderTarget2.samples = MSAA_MAX;
const renderPass = new RenderPass(galaxy.scene, galaxy.camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.7, 0.42);
composer.addPass(bloom);
composer.addPass(new OutputPass());
/* 最后一道：轻微反锐化，把 star / 行星边缘从 bloom 的柔光里拉回来 */
const sharpenPass = makeSharpenPass(window.innerWidth * dprNow, window.innerHeight * dprNow, 0.40);
composer.addPass(sharpenPass);

/* 只改渲染分辨率，不动几何与材质 —— 帧率掉下来时最划算的一刀 */
function applyQuality() {
  const next = clamp(MAX_DPR * qualityScale, QUALITY_FLOOR, 2);
  if (Math.abs(next - dprNow) < 0.02) return;
  dprNow = next;
  renderer.setPixelRatio(next);
  // 分辨率降档时 MSAA 同步减半，省填充带宽（画面几乎看不出差别）
  const ms = next < 1.0 ? Math.min(2, MSAA_MAX) : MSAA_MAX;
  if (composer.renderTarget1.samples !== ms) {
    composer.renderTarget1.samples = ms;
    composer.renderTarget2.samples = ms;
  }
  composer.setSize(window.innerWidth, window.innerHeight);
  sharpenPass.setSize(window.innerWidth * next, window.innerHeight * next);
  Object.values(SCENES).forEach((s) => {
    if (s.resize) s.resize(window.innerWidth, window.innerHeight);
    // 点精灵的 gl_PointSize 是设备像素，分辨率一变就得跟着补偿，否则星星会忽大忽小
    s.scene.traverse((o) => {
      const u = o.material && o.material.uniforms;
      if (u && u.uPixelRatio) u.uPixelRatio.value = next;
    });
  });
}

const BLOOM = {
  galaxy: { strength: 0.74, radius: 0.6, threshold: 0.54 },
  solar: { strength: 0.34, radius: 0.28, threshold: 0.80 },
  earth: { strength: 0.38, radius: 0.5, threshold: 0.8 },
};

/* =========================================================
   交互状态
   ========================================================= */
const st = { yaw: 0, pitch: 0, dolly: 0, dive: 0, earthArrive: 1, intro: 1, solarArrive: 1, galaxyDive: 0, earthOut: 0, nebFade: 0, clean: 0, sunReveal: 1, earthReveal: 1, track: -1 };
/* ---------- 四个固定层级：银河 → 太阳系 → 行星选择 → 行星特写 ---------- */
const LEVELS = ['galaxy', 'solar', 'selector', 'detail'];
let level = 'galaxy';
let levelIndex = 0;
// 层级 3 / 4 的镜头参数（由 solar 场景消费）
st.focus = 2;        // 居中的行星
st.focusPrev = 2;    // 上一颗（切换时做弧形过渡）
st.focusBlend = 1;   // 0→1 切换进度
st.focusAmt = 0;     // 0 = 太阳系全景，1 = 停在行星上
st.detailAmt = 0;    // 0 = 轮播距离，1 = 特写距离
// 层级内的镜头动画（不切场景，只推镜头）
const F = { active: false, t: 0, dur: 1, a: null, b: null, switchOnly: false };
let dollyNow = 0;      // 实际使用的缩放值（每帧向 dollyTarget 平滑靠拢）
let dollyTarget = 0;   // 输入 / 调试钩子写进来的目标值
Object.defineProperty(st, 'dolly', {
  get() { return dollyNow; },
  // 外部直接赋值（applyScene、测试脚本、控制台）时，目标值一起跟过去
  set(v) { dollyNow = v; dollyTarget = v; },
});
let cooldown = 0;
let clock = new THREE.Clock();
const autoIdle = { t: 0 };

/* =========================================================
   过渡（曲速跃迁）
   ========================================================= */
const warpScene = new THREE.Scene();
const warpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const warpMat = new THREE.ShaderMaterial({
  uniforms: {
    uT: { value: 0 },
    uColor: { value: new THREE.Color('#ffb86b') },
    uSeed: { value: Math.random() * 10 },
  },
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uT;
    uniform vec3 uColor;
    uniform float uSeed;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float a = atan(p.y, p.x);

      float env  = sin(clamp(uT, 0.0, 1.0) * 3.14159265);
      float spike = exp(-pow((uT - 0.52) / 0.075, 2.0));

      // 被拉长的星线：角度分片 + 径向推进
      float seg = 0.5 + 0.5 * sin(a * 3.0 + uSeed * 7.0);
      float rays = pow(0.5 + 0.5 * sin(a * 38.0 - log(r + 0.10) * 5.0 - uT * 52.0 + uSeed * 3.0), 15.0);
      float streak = rays * smoothstep(0.05, 0.95, r) * (0.30 + 0.70 * seg);
      float ring = exp(-pow((r - (0.12 + 0.95 * uT)) * 8.0, 2.0));
      float coreFlash = exp(-r * 5.5) * spike;

      float alpha = clamp(env * (0.05 + streak * 0.95 + ring * 0.22) + coreFlash * 0.85, 0.0, 1.0);
      vec3 col = uColor * (0.55 + 1.35 * streak) + uColor * ring * 0.30 + vec3(1.0, 0.98, 0.95) * coreFlash * 1.1;
      gl_FragColor = vec4(col, alpha);
    }
  `,
});
warpScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMat));

// 跃迁时压暗底层画面，避免高光过曝
const veilScene = new THREE.Scene();
const veilMat = new THREE.MeshBasicMaterial({
  color: 0x03060f,
  transparent: true,
  opacity: 0,
  depthTest: false,
  depthWrite: false,
});
veilScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), veilMat));

// 切镜时的一层柔光白闪：太阳系俯冲 → 地球，用它遮住两套场景的接缝
const flashScene = new THREE.Scene();
const flashMat = new THREE.MeshBasicMaterial({
  color: 0xdceaff,
  transparent: true,
  opacity: 0,
  depthTest: false,
  depthWrite: false,
});
flashScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flashMat));

/* ---------- 时空隧道：进场与「升空」时用的隧道壁 ---------- */
const tunnelScene = new THREE.Scene();
const tunnelMat = new THREE.ShaderMaterial({
  uniforms: {
    uT: { value: 0 },
    uA: { value: 0 },
    uAspect: { value: window.innerWidth / window.innerHeight },
    uColor: { value: new THREE.Color('#9fd0ff') },
  },
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uT;
    uniform float uA;
    uniform float uAspect;
    uniform vec3 uColor;

    float hash21(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p){
      float s = 0.0, am = 0.5;
      for (int i = 0; i < 4; i++){ s += am * vnoise(p); p *= 2.03; am *= 0.5; }
      return s;
    }

    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      p.x *= uAspect;
      float r = length(p);
      float a = atan(p.y, p.x);

      // 深度坐标：越靠近中心越大 → 流速越快，形成隧道透视
      float d = 1.0 / (r + 0.16);
      float fly = uT * 3.0;

      // 把「角度 × 深度」当坐标铺一张噪声星场，再沿深度方向取三次做径向拖尾
      vec2 q = vec2(a * 3.4, d * 2.4 - fly * 2.6);
      float n1 = fbm(q * vec2(9.0, 1.7));
      float n2 = fbm((q + vec2(0.0, 0.085)) * vec2(9.0, 1.7));
      float n3 = fbm((q + vec2(0.0, 0.170)) * vec2(9.0, 1.7));
      float s1 = pow(smoothstep(0.46, 0.95, n1), 2.6);
      float s2 = pow(smoothstep(0.46, 0.95, n2), 2.6) * 0.72;
      float s3 = pow(smoothstep(0.46, 0.95, n3), 2.6) * 0.45;
      float stars = max(max(s1, s2), s3);
      stars *= smoothstep(0.02, 0.26, r);      // 中心留干净，让银河跃出

      float dust = fbm(q * vec2(3.1, 0.62)) * 0.16 * smoothstep(0.95, 0.06, r);
      float rings = pow(0.5 + 0.5 * sin(d * 5.0 - uT * 6.5), 4.0) * 0.12;
      float core = exp(-r * r * 42.0);

      float wall = stars * 1.6 + dust + rings;
      float alpha = uA * clamp(wall * (1.0 - r * 0.28) + core * 0.34, 0.0, 1.0);
      vec3 col = uColor * (0.06 + wall * 1.5)
               + vec3(1.0, 0.97, 0.92) * core * 0.60
               + vec3(0.66, 0.86, 1.0) * stars * 0.80;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `,
});
tunnelScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tunnelMat));

const T = { active: false, t: 0, dur: 1.85, to: null, swapped: false, mode: 'warp', swapAt: 0.52 };
const warpLabel = document.getElementById('warp-label');

const SCENE_INFO = {
  galaxy: { cn: '银河系', en: 'Milky Way', tag: 'DEEP SPACE / 银河系', color: '#ffb86b' },
  solar: { cn: '太阳系', en: 'Solar System', tag: 'STELLAR SYSTEM / 太阳系', color: '#7fc8ff' },
  earth: { cn: '地球', en: 'Earth', tag: 'HOME WORLD / 地球', color: '#b08cff' },
};

const easeIO = (x) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

/* ---------------- 15 秒电影级推进曲线 ---------------- */
// 速度分段：0–3s 缓慢起步，3–10s 逐渐加速，10–13s 刹车，13–15s 缓缓收尾。
// 对速度做积分 → 归一化，就得到「尺度进度 P(时间)」的查找表。
const CINEMA_DUR = 7.0;
const CINEMA_TABLE = (() => {
  const N = 1500;
  const dt = CINEMA_DUR / N;
  const v = (t) => {
    if (t < 1.5) return 0.10 + 0.03 * (t / 1.5);
    if (t < 4.4) return 0.13 + 1.05 * Math.pow((t - 1.5) / 2.9, 1.8);
    if (t < 6.0) return 0.13 + 1.05 * Math.pow(1 - (t - 4.4) / 1.6, 1.4);
    return 0.13 * (1 - 0.5 * ((t - 6.0) / 1.0));
  };
  const out = new Float32Array(N + 1);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += v(i * dt) * dt;
    out[i + 1] = acc;
  }
  for (let i = 0; i <= N; i++) out[i] /= acc;
  return out;
})();
function cinemaP(u) {
  const n = CINEMA_TABLE.length - 1;
  const x = clamp(u, 0, 1) * n;
  const i = Math.floor(x);
  const f = x - i;
  return CINEMA_TABLE[i] * (1 - f) + CINEMA_TABLE[Math.min(i + 1, n)] * f;
}

function beginTransition(to) {
  if (T.active) return;
  const from = currentKey;
  let mode = 'warp';
  let dur = 1.85;
  let swapAt = 0.52;
  let label = `跃迁 · ${SCENE_INFO[to].cn}`;

  if (from === 'galaxy' && to === 'solar') {
    // 朝太阳在银河里的位置冲过去：银河一路放大，最后一刻才换成太阳系
    mode = 'galaxyDive';
    dur = CINEMA_DUR;      // 15 秒电影级长镜头
    swapAt = 0.80;         // 12s 处从银河切到太阳系，后面 3s 收尾
    label = '穿越猎户臂 · 太阳系';
  } else if (from === 'solar' && to === 'earth') {
    mode = 'dive';
    dur = 7.0;          // 太阳系 → 地球：一段连续推进的长镜头
    swapAt = 0.80;
    label = '俯冲 · 地球';
  } else if (from === 'earth' && to === 'galaxy') {
    // 从一个点里长回整片银河
    mode = 'emerge';
    dur = 3.1;
    swapAt = 0.38;
    label = '升空 · 银河系';
  } else if (from === 'galaxy' && to === 'earth') {
    // 一路冲进银盘，穿过隧道后地球从光点里推到眼前
    mode = 'galaxyEarth';
    dur = 3.8;
    swapAt = 0.50;
    label = '穿越银盘 · 地球';
  } else if (from === 'earth' && to === 'solar') {
    // 地球退成一个光点，再从光点里拉出整个太阳系
    mode = 'earthSolar';
    dur = 3.3;
    swapAt = 0.44;
    label = '升空 · 太阳系';
  } else if (from === 'solar' && to === 'galaxy') {
    // 太阳系缩成一颗星，再从这颗星里展开银河
    mode = 'solarGalaxy';
    dur = 3.5;
    swapAt = 0.46;
    label = '驶离太阳系 · 银河系';
  }

  T.active = true;
  T.t = 0;
  T.to = to;
  T.swapped = false;
  T.mode = mode;
  // 15 秒电影级长镜头期间收起所有 UI（无文字、无面板），落地后再淡回来
  document.body.classList.toggle('cinema', mode === 'galaxyDive' || mode === 'dive');
  T.dur = dur;
  T.swapAt = swapAt;
  document.body.classList.add('is-busy');
  st.dive = 0;
  st.galaxyDive = 0;
  st.sunReveal = 1;
  st.earthReveal = 1;
  st.track = -1;
  st.earthOut = 0;
  st.solarArrive = 1;
  warpMat.uniforms.uColor.value.set(SCENE_INFO[to].color);
  warpMat.uniforms.uSeed.value = Math.random() * 10;
  tunnelMat.uniforms.uColor.value.set(to === 'solar' ? '#ffcf9a' : '#9fd0ff');
  warpLabel.textContent = label;
  warpLabel.classList.add('show');
  audio.transition(mode, dur, swapAt);
}

/* 进场：加载页 → 银河系，先穿一段时空隧道，银河再从中心长出来 */
function beginIntro() {
  if (T.active) return;
  T.active = true;
  T.t = 0;
  T.to = 'galaxy';
  T.swapped = false;
  T.mode = 'intro';
  T.dur = 3.6;
  T.swapAt = 0.5;
  document.body.classList.add('is-busy');
  st.intro = 0;
  tunnelMat.uniforms.uColor.value.set('#9fd0ff');
  warpLabel.textContent = '进入宇宙';
  warpLabel.classList.add('show');
  audio.transition('intro', 3.6, 0.5);
}

function syncBloom(key) {
  const on = key === 'galaxy' || level === 'detail';
  bloom.enabled = on;
  bloom.strength = on ? BLOOM[key].strength : 0;
  bloom.radius = BLOOM[key].radius;
  bloom.threshold = BLOOM[key].threshold;
}

function applyScene(key) {
  currentKey = key;
  active = SCENES[key];
  renderPass.scene = active.scene;
  renderPass.camera = active.camera;
  syncBloom(key);
  bloom.radius = BLOOM[key].radius;
  bloom.threshold = BLOOM[key].threshold;

  if (key === 'earth') {
    st.dolly = 0.55;
    if (active.resetOrientation) active.resetOrientation();
  } else {
    st.dolly = 0;
  }
  st.yaw = 0;
  st.pitch = key === 'solar' ? 0.44 : key === 'galaxy' ? 0.1 : 0;
  st.dive = 0;
  st.earthArrive = 1;
  st.galaxyDive = 0;
  st.solarArrive = 1;
  st.earthOut = 0;
  if (key !== 'galaxy') st.intro = 1;
  updateHUD(key);
  setLevel(key === 'galaxy' ? 'galaxy' : 'solar');
  audio.setScene(key);
  syncNav();
}

/* =========================================================
   HUD 数据
   ========================================================= */
const HUD_DATA = {
  galaxy: {
    tag: 'DEEP SPACE / 银河系',
    title: '银河系',
    subtitle: 'Milky Way · 棒旋星系 SBbc',
    rows: [
      ['星系半径', '约 5.3 万 <em>光年</em>'],
      ['星系直径', '约 10 – 12 万 <em>光年</em>'],
      ['恒星数量', '1000 – 4000 亿 <em>颗</em>'],
      ['中心黑洞', '人马座 A* · 4.3×10⁶ <em>M☉</em>'],
      ['星系年龄', '约 136 亿 <em>年</em>'],
      ['太阳位置', '猎户臂 · 距中心 2.6 万光年'],
      ['旋转方向', '顺时针 · 外侧约 220 km/s'],
    ],
    note: '张开手掌 → 加速穿越旋臂，进入太阳系。',
  },
  solar: {
    tag: 'STELLAR SYSTEM / 太阳系',
    title: '太阳系',
    subtitle: 'Solar System · 8 颗行星 + 小行星带',
    rows: [
      ['太阳年龄', '约 46 亿 <em>年</em>'],
      ['主要组成', '氢 73.5% · 氦 24.9%'],
      ['其他元素', '氧、碳、铁等 1.6%'],
      ['表面温度', '约 5500 <em>°C</em>'],
      ['核心温度', '约 1500 万 <em>°C</em>'],
      ['太阳质量', '1.989×10³⁰ <em>kg</em>'],
      ['行星数量', '8 颗 · 体积比真实'],
      ['最近恒星', '比邻星 4.24 <em>光年</em>'],
    ],
    note: '滚轮放大时，镜头朝「视野中心最近的那颗行星」推进；张开手掌 → 进入行星选择。',
  },
  earth: {
    tag: 'HOME WORLD / 地球',
    title: '地球',
    subtitle: 'Earth · 第三行星',
    rows: [
      ['表面积', '5.10 亿 <em>km²</em>'],
      ['陆地面积', '1.49 亿 <em>km²</em> · 29.2%'],
      ['海洋面积', '3.61 亿 <em>km²</em> · 70.8%'],
      ['陆海比值', '约 1 : 2.43'],
      ['平均半径', '6371 <em>km</em>'],
      ['自转周期', '23 时 56 分 4 秒'],
      ['公转周期', '365.26 <em>天</em>'],
    ],
    note: '手掌任意方向移动 → 转动地球；握拳缩小 → 返回银河系。',
  },
};

const hudEl = document.getElementById('hud');
const hudTag = document.getElementById('hud-tag');
const hudTitle = document.getElementById('hud-title');
const hudSubtitle = document.getElementById('hud-subtitle');
const hudRows = document.getElementById('hud-rows');
const hudNote = document.getElementById('hud-note');
let hudTimer = null;

function renderHUD(key) {
  const d = HUD_DATA[key];
  hudTag.textContent = d.tag;
  hudTitle.textContent = d.title;
  hudSubtitle.textContent = d.subtitle;
  hudNote.textContent = d.note;
  hudRows.innerHTML = d.rows
    .map(([k, v], i) => `<div class="row" style="animation-delay:${i * 55}ms"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');
}


/* ---------------- 行星资料（层级 3 / 4 的信息面板） ---------------- */
const PLANET_INFO = [
  { name: '水星', en: 'Mercury', r: '2,440 km', d: '0.39 AU', p: '88 天', t: '427 / -173 ℃', note: '没有大气层，昼夜温差近 600℃；表面布满撞击坑。' },
  { name: '金星', en: 'Venus', r: '6,052 km', d: '0.72 AU', p: '225 天', t: '464 ℃', note: '浓密的二氧化碳大气与硫酸云，温室效应把它烧成了最热的行星。' },
  { name: '地球', en: 'Earth', r: '6,371 km', d: '1.00 AU', p: '365 天', t: '15 ℃', note: '已知唯一存在液态水海洋与生命的世界，一层薄大气托住了整个生物圈。' },
  { name: '火星', en: 'Mars', r: '3,390 km', d: '1.52 AU', p: '687 天', t: '-63 ℃', note: '氧化铁让地表发红；有太阳系最高的火山奥林帕斯山。' },
  { name: '木星', en: 'Jupiter', r: '69,911 km', d: '5.20 AU', p: '11.9 年', t: '-145 ℃', note: '气态巨行星，大红斑是持续数百年的风暴；拥有 95 颗以上已知卫星。' },
  { name: '土星', en: 'Saturn', r: '58,232 km', d: '9.54 AU', p: '29.5 年', t: '-178 ℃', note: '环系主要由水冰颗粒组成，厚度不到 1 公里，却宽达 28 万公里。' },
  { name: '天王星', en: 'Uranus', r: '25,362 km', d: '19.2 AU', p: '84 年', t: '-224 ℃', note: '自转轴几乎躺倒在轨道面上，像滚球一样绕太阳走。' },
  { name: '海王星', en: 'Neptune', r: '24,622 km', d: '30.1 AU', p: '165 年', t: '-214 ℃', note: '风速可达 2,100 km/h，是太阳系风暴最猛烈的行星。' },
];

function renderPlanetHUD(mode) {
  const p = PLANET_INFO[st.focus] || PLANET_INFO[2];
  hudTag.textContent = mode === 'detail' ? `LEVEL 4 / 4 · ${p.en.toUpperCase()}` : 'LEVEL 3 / 4 · 行星选择';
  hudTitle.textContent = mode === 'detail' ? p.name : '行星选择';
  hudSubtitle.textContent = mode === 'detail' ? `${p.en} · 太阳系第 ${st.focus + 1} 颗行星` : 'Swipe to switch · 左右滑动切换';
  const rows = mode === 'detail'
    ? [
      ['赤道半径', p.r],
      ['轨道半径', p.d],
      ['公转周期', p.p],
      ['表面温度', p.t],
      ['卫星', st.focus === 0 || st.focus === 1 ? '无' : '有 · 见画面'],
    ]
    : [
      ['当前行星', `${p.name} · ${p.en}`],
      ['轨道半径', p.d],
      ['公转周期', p.p],
      ['切换方式', '掌心左右滑动'],
      ['确认', '拇指 + 食指捏合'],
      ['返回', '握拳'],
    ];
  hudNote.textContent = mode === 'detail' ? p.note : '捏合确认进入特写，握拳返回太阳系。';
  hudRows.innerHTML = rows
    .map(([k, v], i) => `<div class="row" style="animation-delay:${i * 55}ms"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');
}

let hudKey = '';
function updateLevelHud() {
  if (level === 'selector' || level === 'detail') {
    // 只在「层级或选中行星变了」时重绘：每帧重写 innerHTML 会让入场动画一直重播，
    // 结果就是列表永远停在 opacity:0 的空白状态
    const k = `${level}:${st.focus}`;
    if (k !== hudKey) { hudKey = k; renderPlanetHUD(level); }
  } else {
    renderHUD(level === 'galaxy' ? 'galaxy' : 'solar');
  }
}

function updateHUD(key) {
  if (hudTimer) clearTimeout(hudTimer);
  hudEl.classList.add('out');
  hudTimer = setTimeout(() => {
    if (level === 'selector' || level === 'detail') {
      // 交给 updateLevelHud 的缓存判断，避免每 220ms 重播一次行入场动画
      const k = `${level}:${st.focus}`;
      if (k !== hudKey) { hudKey = k; renderPlanetHUD(level); }
    } else renderHUD(key);
    hudEl.classList.remove('out');
  }, 220);
}

/* =========================================================
   输入：鼠标 / 触摸 / 键盘
   ========================================================= */
let mouseDown = false;
let lastX = 0, lastY = 0;
/* 拖拽惯性：输入只往这里累加，主循环每帧吃掉一部分，剩下的留到下一帧 */
const panPending = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (T.active || F.active) return;
  mouseDown = true;
  lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  mouseDown = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!mouseDown || T.active || F.active) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  // 不直接改视角，先塞进「待消费队列」，由主循环按指数衰减摊到几帧里 —— 拖拽才有惯性
  if (level === 'detail') {
    // 特写：拖拽转的是行星本体，不是相机
    st.detailYaw = (st.detailYaw || 0) - dx * 0.0062;
    st.detailPitch = clamp((st.detailPitch || 0) + dy * 0.0052, -1.5, 1.5);
  } else {
    panPending.x -= dx * 0.0042;
    panPending.y += dy * 0.0032;
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (T.active || F.active) return;   // 动画锁：过渡期间不接受鼠标缩放
  const zoomIn = e.deltaY < 0;
  dollyTarget = clamp(dollyTarget - e.deltaY * 0.00065, 0, 1);
  if (level === 'solar') {
    // 放大时对焦「视线中心方向 + 离镜头最近」的行星；没对准任何行星就只拉近
    if (zoomIn) {
      const idx = SCENES.solar.nearestInView ? SCENES.solar.nearestInView() : -1;
      if (idx >= 0) st.track = idx;
    } else if (dollyTarget < 0.10) {
      st.track = -1;                  // 拉远到全景就放开跟随，回到自由观察
    }
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '1') navTo('galaxy');
  if (e.key === '2' && level === 'galaxy') beginTransition('solar');
  if (e.key === '3') navTo('selector');
  if (e.key === '4') navTo('detail');
  if (e.key === 'ArrowLeft' && level === 'selector') switchPlanet(-1);
  if (e.key === 'ArrowRight' && level === 'selector') switchPlanet(1);
  if (e.key === 'Backspace' || e.key === 'Escape') {
    e.preventDefault();
    if (level === 'detail') beginFocus('fromDetail');
    else if (level === 'selector') beginFocus('fromSelector');
    else if (level === 'solar') beginTransition('galaxy');
  }
});

const PLANET_NAMES = ['水星', '金星', '地球', '火星', '木星', '土星', '天王星', '海王星'];
const easeCine = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function planetWorldPos(i, out) {
  const sc = SCENES.solar;
  if (!sc || !sc.planetPos) return out.set(0, 0, 0);
  return sc.planetPos(i, out);
}

// 找离相机最近的那颗行星：进入选择页时从它开始
function nearestPlanet() {
  // 优先「视线中心那颗」；没有明确目标时保留当前选中，不再退回水星
  if (SCENES.solar.nearestInView) {
    const idx = SCENES.solar.nearestInView();
    if (idx >= 0) return idx;
  }
  return typeof st.focus === 'number' && st.focus >= 0 ? st.focus : 2;
}

function beginFocus(kind) {
  if (F.active || T.active) return;
  const cur = { focusAmt: st.focusAmt, detailAmt: st.detailAmt };
  F.active = true;
  F.t = 0;
  F.switchOnly = false;
  F.a = cur;
  if (kind === 'toSelector') {
    st.focus = nearestPlanet();
    st.focusPrev = st.focus;
    st.focusBlend = 1;
    st.detailAmt = 0;
    F.dur = 3.0;
    F.b = { focusAmt: 1, detailAmt: 0 };
    F.done = 'selector';
    F.label = '锁定行星 · 选择';
  } else if (kind === 'toDetail') {
    F.dur = 2.2;
    F.b = { focusAmt: 1, detailAmt: 1 };
    F.done = 'detail';
    F.label = `抵近观测 · ${PLANET_NAMES[st.focus]}`;
  } else if (kind === 'fromDetail') {
    F.dur = 1.8;
    F.b = { focusAmt: 1, detailAmt: 0 };
    F.done = 'selector';
    F.label = '返回 · 行星选择';
  } else if (kind === 'fromSelector') {
    F.dur = 2.4;
    F.b = { focusAmt: 0, detailAmt: 0 };
    F.done = 'solar';
    F.label = '退出 · 太阳系';
  }
  document.body.classList.add('cinema', 'is-busy');
  warpLabel.textContent = F.label;
  warpLabel.classList.add('show');
  warpLabel.style.opacity = '1';
  audio.transition('warp', F.dur, 0.5);
}

// 左右切换：镜头沿弧线从一颗行星绕到隔壁那颗
function jumpPlanet(i) {
  if (F.active || T.active) return;
  if (level !== 'selector') return;
  if (i === st.focus) return;
  st.focusPrev = st.focus;
  st.focus = (i + 8) % 8;
  st.focusBlend = 0;
  F.active = true;
  F.t = 0;
  F.dur = 1.45;
  F.a = { focusAmt: 1, detailAmt: 0 };
  F.b = { focusAmt: 1, detailAmt: 0 };
  F.switchOnly = true;
  F.done = null;
  F.label = PLANET_NAMES[st.focus];
  warpLabel.textContent = F.label;
  warpLabel.classList.add('show');
  warpLabel.style.opacity = '1';
  syncPlanetNav();
  if (typeof syncBloom === 'function' && SCENES[currentKey]) syncBloom(currentKey);
}

function switchPlanet(dir) {
  if (level !== 'selector') return;
  jumpPlanet((st.focus + dir + 8) % 8);
}

function setLevel(next) {
  if (!LEVELS.includes(next)) return;
  level = next;
  levelIndex = LEVELS.indexOf(next);
  document.body.dataset.level = next;
  // 直接落到特写（含 URL 参数）时把 detailAmt 补满，行星姿态转动才会生效
  if (next === 'detail') st.detailAmt = 1;
  else if (next === 'selector') st.detailAmt = 0;
  if (typeof syncNav === 'function') syncNav();
  if (typeof syncPlanetNav === 'function') syncPlanetNav();
  // 层级决定后处理开销：只有行星特写重新打开 Bloom
  if (typeof syncBloom === 'function' && SCENES[currentKey]) syncBloom(currentKey);

  // 手势条按层级换文案
  const gText = document.getElementById('gesture-text');
  const gSub = document.getElementById('gesture-sub');
  const HINT = {
    galaxy: ['张开手掌 = 穿越猎户臂', '握拳 = 停留 · 左右移动手掌 = 转动视角'],
    solar: ['张开手掌 = 进入行星选择', '握拳 = 返回银河系 · 手掌移动 = 转视角'],
    selector: ['左右滑动 = 切换行星', '捏合 = 进入特写 · 握拳 = 返回太阳系'],
    detail: ['握拳 = 返回行星选择', '手掌移动 = 环绕观察 · 滚轮 = 远近'],
  };
  const h = HINT[next] || HINT.galaxy;
  if (gText) gText.textContent = h[0];
  if (gSub) gSub.textContent = h[1];
  if (next === 'selector' || next === 'detail') {
    if (typeof renderPlanetHUD === 'function') renderPlanetHUD(next);
  }
}

// 固定层级：只允许相邻层级互相跳，越级点击一律无响应
const NAV_ALLOWED = {
  galaxy: ['solar'],
  solar: ['galaxy', 'selector'],
  selector: ['solar', 'detail'],
  detail: ['selector'],
};

// 鼠标点标签：允许跨层级直接跳，且不播逐级过渡动画（手势才受「只能走一层」约束）
function jumpToLevel(target) {
  if (!LEVELS.includes(target)) return;
  // 先干净地中断任何进行中的动画，避免跳转后残留遮罩
  T.active = false; T.t = 0;
  F.active = false; F.t = 0;
  warpMat.uniforms.uT.value = 0;
  tunnelMat.uniforms.uA.value = 0;
  veilMat.opacity = 0;
  flashMat.opacity = 0;
  document.body.classList.remove('cinema', 'is-busy');
  warpLabel.style.opacity = '';
  if (warpLabel) warpLabel.textContent = '';

  const sceneKey = target === 'galaxy' ? 'galaxy' : 'solar';
  applyScene(sceneKey);

  st.dive = 0;
  st.earthOut = 0;
  st.galaxyDive = 0;
  st.nebFade = 0;
  st.clean = 0;
  st.sunReveal = 1;
  st.track = -1;
  if (target === 'galaxy') {
    st.intro = 1;
    st.dolly = 0;
  } else {
    st.solarArrive = 1;
    st.detailYaw = 0;
    st.detailPitch = 0;
    st.focusAmt = target === 'selector' || target === 'detail' ? 1 : 0;
    st.detailAmt = target === 'detail' ? 1 : 0;
    st.focusBlend = 1;
    st.focusPrev = st.focus;
    if (target === 'selector' || target === 'detail') st.dolly = 0.55;
    else st.dolly = 0;
  }
  setLevel(target);
  if (typeof audio !== 'undefined' && audio && audio.setScene) audio.setScene(sceneKey);
}

function navTo(target) {
  jumpToLevel(target);
}

function jumpTo(key) { navTo(key); }

document.querySelectorAll('.scene-nav .nav-btn').forEach((el) => {
  el.addEventListener('click', () => navTo(el.dataset.goto));
});


/* ---------- 层级 3：行星缩略导航（鼠标备选，状态与手势共用 st.focus） ---------- */
const PNAV_COLORS = ['#b9b0a4', '#e0c48a', '#4f8fd0', '#c1683f', '#d8b98a', '#e2cf9d', '#9fe0e8', '#6c8fe0'];
const PNAV_KEY = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
let planetNavEls = [];

function buildPlanetNav() {
  const host = document.getElementById('planet-nav');
  if (!host) return;
  host.innerHTML = '';
  planetNavEls = PNAV_KEY.map((key, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pnav-btn';
    b.dataset.index = String(i);
    b.style.color = PNAV_COLORS[i];
    b.innerHTML = `<span class="dot"></span><span class="cn">${PLANET_INFO[i].name}</span>`;
    b.addEventListener('click', () => jumpPlanet(i));
    host.appendChild(b);
    return b;
  });
  syncPlanetNav();
}

function syncPlanetNav() {
  planetNavEls.forEach((el, i) => {
    const on = i === st.focus;
    el.classList.toggle('is-active', on);
    el.style.color = on ? '#eaf6ff' : PNAV_COLORS[i];
  });
}

/* 底部导航高亮：按当前层级，而不是按场景 */
function syncNav() {
  document.querySelectorAll('.scene-nav .nav-btn').forEach((el) => {
    const on = el.dataset.goto === level;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
}

/* =========================================================
   手势
   ========================================================= */
const video = document.getElementById('cam');
const camOverlay = document.getElementById('cam-overlay');
const camStatus = document.getElementById('cam-status');
const camDot = document.getElementById('cam-dot');
const camMode = document.getElementById('cam-mode');

const tracker = createHandTracker({ video, overlay: camOverlay });
const G = tracker.state;
let prevHand = null;
let palmSmooth = null;
let mouseMode = true;

function setCamStatus(text, cls) {
  camStatus.textContent = text;
  camDot.className = 'cam-dot ' + (cls || '');
}

async function startCamera() {
  try {
    await tracker.init((text, cls) => {
      setCamStatus(text, cls);
      if (text.includes('就绪')) {
        mouseMode = false;
        camMode.textContent = '手势追踪中 · 实时骨骼识别';
      }
    });
    mouseMode = false;
    camMode.textContent = '手势追踪中 · 实时骨骼识别';
  } catch (err) {
    mouseMode = true;
    setCamStatus('鼠标模式', 'err');
    camMode.textContent = '摄像头不可用 · 使用鼠标拖拽 + 滚轮';
    console.warn('摄像头初始化失败：', err);
  }
}

let holdG = null;
let holdT = 0;
let swipeAcc = 0;
const swipe = { active: false, x0: 0, y0: 0, t0: 0 };
let hintT = 0;

// 手势防抖：同一个手势必须稳定保持 0.30s 才生效，生效后必须松手才可能再次触发
function consumeHold(g, dt) {
  if (!G.present || G.gesture !== g) {
    if (holdG === g) { holdG = null; holdT = 0; }
    return false;
  }
  if (holdG !== g) { holdG = g; holdT = 0; }
  holdT += dt;
  if (holdT >= 0.30) {
    holdT = -1e6; // 锁死，直到手势变化
    return true;
  }
  return false;
}

function homeHint() {
  if (hintT > 0) return;
  hintT = 2.4;
  warpLabel.textContent = '已在层级 1 · 银河系';
  warpLabel.classList.add('show');
  warpLabel.style.opacity = '1';
}

let simSwipe = null;   // 调试：脚本化的一次手掌滑动
function feedSimSwipe(dt) {
  simSwipe.t += 1 / 7;   // 按帧推进，无头低帧率下也能走完
  const p = Math.min(1, simSwipe.t / 0.42);
  G.present = true;
  G.gesture = 'open';
  G.openness = 1;
  G.palm = { x: 0.5 + simSwipe.dir * 0.28 * p, y: 0.5 };
  if (p >= 1) simSwipe = null;
}

function readGestures(dt) {
  if (mouseMode && !simSwipe) { swipeAcc *= 0.9; return; }
  if (simSwipe) feedSimSwipe(dt);
  else tracker.update(performance.now());
  if (hintT > 0) hintT -= dt;

  // 转场期间只保留基础视角旋转，所有跳转手势锁定
  const locked = T.active || F.active;

  if (G.present) {
    // 手部关键点本身有 2–3px 抖动，先低通再算位移，否则画面会「呼吸」
    if (!palmSmooth) palmSmooth = { x: G.palm.x, y: G.palm.y };
    palmSmooth.x += (G.palm.x - palmSmooth.x) * 0.34;
    palmSmooth.y += (G.palm.y - palmSmooth.y) * 0.34;

    // ---- 平移（带死区，避免手抖导致画面乱转）----
    let dx = 0;
    let dy = 0;
    if (prevHand) {
      dx = palmSmooth.x - prevHand.x;
      dy = palmSmooth.y - prevHand.y;
      if (level === 'detail') {
        // 特写：手掌位移直接转动行星本体（相机不动）
        if (Math.abs(dx) > 0.0012) st.detailYaw = (st.detailYaw || 0) + dx * 7.2;
        if (Math.abs(dy) > 0.0012) {
          st.detailPitch = clamp((st.detailPitch || 0) + dy * 5.6, -1.5, 1.5);
        }
      } else {
        if (Math.abs(dx) > 0.0016) panPending.x += dx * 6.4;
        if (Math.abs(dy) > 0.0016) panPending.y += dy * 5.0;
      }
    }
    prevHand = { x: palmSmooth.x, y: palmSmooth.y };

    if (locked) { swipeAcc = 0; return; }

    // ---- 层级 3：滑动切行星 ----
    // 规格：手掌全程完全张开；水平位移 ≥ 画面宽 12%；垂直偏移 < 5%；
    // 匀速平移时长 ≥ 0.25s。不套 0.3s 延时（那是给捏合/握拳的）。
    if (level === 'selector' && !locked) {
      if (G.gesture === 'open') {
        const nowS = performance.now() * 0.001;
        if (!swipe.active) {
          swipe.active = true;
          swipe.x0 = palmSmooth.x;
          swipe.y0 = palmSmooth.y;
          swipe.t0 = nowS;
        } else {
          const dxs = palmSmooth.x - swipe.x0;
          const dys = palmSmooth.y - swipe.y0;
          const dur = nowS - swipe.t0;
          // 滑动意图明确时压住视角旋转，避免一边切行星一边转场景
          if (Math.abs(dxs) > 0.03) panPending.x *= 0.55;
          if (Math.abs(dxs) > 0.12 && Math.abs(dys) < 0.05 && dur >= 0.25) {
            if (dxs < 0) switchPlanet(-1);   // 向左滑 = 上一颗
            else switchPlanet(1);            // 向右滑 = 下一颗
            swipe.active = false;
          } else if (dur > 1.8) {
            swipe.active = false;
          }
        }
      } else {
        swipe.active = false;
      }
    } else {
      swipe.active = false;
    }

    // ---- 各层级手势 ----
    if (level === 'galaxy') {
      if (consumeHold('open', dt)) beginTransition('solar');
      else if (consumeHold('fist', dt)) homeHint();
    } else if (level === 'solar') {
      if (consumeHold('open', dt)) beginFocus('toSelector');
      else if (consumeHold('fist', dt)) beginTransition('galaxy');
    } else if (level === 'selector') {
      if (consumeHold('pinch', dt)) beginFocus('toDetail');
      else if (consumeHold('fist', dt)) beginFocus('fromSelector');
    } else if (level === 'detail') {
      if (consumeHold('fist', dt)) beginFocus('fromDetail');
    }

    // ---- 层级 1 / 2 保留手掌深度推拉（当作缩放手感）----
    if (level === 'galaxy' || level === 'solar') {
      if (G.gesture === 'open') {
        const strength = clamp((G.openness - 0.6) / 0.4, 0.35, 1);
        dollyTarget = clamp(dollyTarget + dt * 0.62 * strength, 0, 1);
      } else if (G.gesture === 'fist') {
        dollyTarget = clamp(dollyTarget - dt * 0.62, 0, 1);
      }
    }
  } else {
    prevHand = null;
    palmSmooth = null;
    swipeAcc = 0;
  }
}

/* =========================================================
   主循环
   ========================================================= */
const zoomFill = document.getElementById('zoom-fill');
const gestureText = document.getElementById('gesture-text');

/* ---------- 邻近星系的名字标签（HTML 投影，比 Sprite 文字更清晰） ---------- */
const labelsEl = document.getElementById('labels');
let labelEls = null;
const labelSets = { galaxy: [], solar: [] };
const labelVec = new THREE.Vector3();

function makeLabelEl(a) {
  const el = document.createElement('div');
  el.className = 'clabel';
  const b = document.createElement('b');
  b.textContent = a.text;
  const i = document.createElement('i');
  i.textContent = a.sub || '';
  el.append(b, i);
  if (a.small) el.classList.add('clabel-sm');
  labelsEl.appendChild(el);
  return el;
}

function buildLabels() {
  if (!labelsEl) return;
  labelsEl.innerHTML = '';
  ['galaxy', 'solar'].forEach((key) => {
    const anchors = (SCENES[key] && SCENES[key].anchors) || [];
    labelSets[key] = anchors.map(makeLabelEl);
  });
  labelEls = labelSets.galaxy;
}

function updateLabels() {
  if (!labelEls) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const introOk = currentKey !== 'galaxy' || st.intro >= 0.985;

  for (const key of ['galaxy', 'solar']) {
    const anchors = (SCENES[key] && SCENES[key].anchors) || [];
    const els = labelSets[key];
    const cam = SCENES[key].camera;
    const show = currentKey === key && !T.active && introOk;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const a = anchors[i];
      if (!a || !show) {
        if (el._op !== 0) { el.style.opacity = 0; el._op = 0; }
        continue;
      }
      labelVec.copy(a.pos).project(cam);
      if (labelVec.z > 1) {
        if (el._op !== 0) { el.style.opacity = 0; el._op = 0; }
        continue;
      }
      const x = (labelVec.x * 0.5 + 0.5) * w;
      const y = (-labelVec.y * 0.5 + 0.5) * h;
      const fadeX = 1 - smoothstep(0.84, 0.99, Math.abs(labelVec.x));
      const fadeY = 1 - smoothstep(0.84, 0.99, Math.abs(labelVec.y));
      const op = Math.round(fadeX * fadeY * (a.alpha == null ? 1 : a.alpha) * 100) / 100;
      // 只在真的挪动/变淡时写样式，省掉每帧一次样式重算
      const tf = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${(y - 12).toFixed(1)}px)`;
      if (el._tf !== tf) { el.style.transform = tf; el._tf = tf; }
      if (el._op !== op) { el.style.opacity = op; el._op = op; }
    }
  }
}

const GESTURE_HINT = {
  galaxy: ['张开手掌 = 进入太阳系', '握拳 = 停留 · 移动手掌 = 转动视角'],
  solar: ['左右上下移动手掌 = 改变观察太阳系的视角', '张开手掌 = 飞向行星选择 · 握拳 = 返回银河系'],
  selector: ['左右滑动 = 切换行星', '捏合 = 进入特写 · 握拳 = 返回太阳系'],
  detail: ['握拳 = 返回行星选择', '鼠标拖拽 = 旋转行星 · 滚轮 = 缩放'],
};

/* =========================================================
   主循环
   ========================================================= */
let lastFrameMs = performance.now();
let fpsAcc = 0; let fpsN = 0; let fpsNow = 0;
let lodAcc = 0;
let lodN = 0;
let lodHold = 0;
let uiAcc = 0;
let prevYaw = 0;
let rollNow = 0;

function tick() {
  requestAnimationFrame(tick);
  const rawMs = performance.now() - lastFrameMs;
  // 轻量帧率计：只做一次加法，不影响渲染
  fpsAcc += rawMs; fpsN += 1;
  if (fpsAcc >= 500) { fpsNow = (fpsN * 1000) / fpsAcc; fpsAcc = 0; fpsN = 0; }
  lastFrameMs = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);

  if (cooldown > 0) cooldown -= dt;

  readGestures(dt);

  /* --------- 视角：把排队的拖拽/手势位移按时间常数摊开，带一点惯性 --------- */
  if (!T.active && (panPending.x !== 0 || panPending.y !== 0)) {
    const kp = 1 - Math.exp(-dt / 0.055);
    const ax = panPending.x * kp;
    const ay = panPending.y * kp;
    st.yaw += ax;
    panPending.x -= ax;
    // 地球要能 360° 翻；银河与太阳系也放开到大半个球，转起来更有纵深
    const lim = currentKey === 'earth' ? Infinity : 1.42;
    st.pitch = clamp(st.pitch + ay, -lim, lim);
    panPending.y -= ay;
    if (Math.abs(panPending.x) < 1e-4) panPending.x = 0;
    if (Math.abs(panPending.y) < 1e-4) panPending.y = 0;
  } else if (T.active) {
    panPending.x = 0; panPending.y = 0;
  }

  /* --------- 过渡推进 --------- */
  /* --------- 层级内镜头动画（选择 / 特写 / 切换行星） --------- */
  if (F.active) {
    F.t = Math.min(1, F.t + dt / F.dur);
    const e = easeCine(F.t);
    if (F.switchOnly) {
      st.focusBlend = e;
      if (F.t >= 1) { F.active = false; warpLabel.classList.remove('show'); updateLevelHud(); }
    } else {
      st.focusAmt = lerp(F.a.focusAmt, F.b.focusAmt, e);
      st.detailAmt = lerp(F.a.detailAmt, F.b.detailAmt, e);
      if (F.t >= 1) {
        F.active = false;
        document.body.classList.remove('cinema', 'is-busy');
        warpLabel.classList.remove('show');
        warpLabel.style.opacity = '';
        if (F.done) setLevel(F.done);
        updateLevelHud();
      }
    }
  }

  if (T.active) {
    T.t += dt / T.dur;
    const tt = Math.min(T.t, 1);
    // 标题在落地那一刻淡掉，别压在刚出现的星球上
    if (T.mode !== 'warp') warpLabel.style.opacity = String(Math.max(0, 1 - smoothstep(0.52, 0.80, tt)));

    if (T.mode === 'dive') {
      /* 太阳系 → 地球：前 2.6 秒镜头一路俯冲到地球表面，随后切到地球场景再缓缓拉开 */
      const A = T.swapAt;
      if (tt < A) {
        // 先快后慢：一开始地球在远处迅速变大，占据画面后明显减速
        st.dive = 1 - Math.pow(1 - tt / A, 2.6);
        // 贴近太阳时压一点辉光，避免整屏过曝
        bloom.strength = BLOOM.solar.strength * (1 - 0.32 * st.dive);
        veilMat.opacity = 0;
        warpMat.uniforms.uT.value = 0;
        flashMat.opacity = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          // 先把俯冲末帧的太阳方向 / 机位 / 自转角记下来，切场景后立刻对齐，
          // 这样切过去的第一帧和太阳系里的最后一帧是同一个取景，不需要靠白闪遮接缝
          const handoff = SCENES.solar.getHandoff ? SCENES.solar.getHandoff() : null;
          applyScene('earth');
          if (handoff && SCENES.earth.adoptHandoff) SCENES.earth.adoptHandoff(handoff);
          st.dive = 0;
        }
        const since = (tt - A) * T.dur; // 距离切镜过了几秒
        flashMat.opacity = since < 0.12 ? 0.10 * Math.exp(-Math.pow(since / 0.05, 2)) : 0;
        // 泛光参数也一起补间：太阳系那套更亮更散，地球那套更收敛，
        // 直接硬切会让画面亮度「啪」地变一下
        const settle = clamp((st.earthArrive - 0.60) / 0.40, 0, 1);
        bloom.strength = lerp(BLOOM.solar.strength, BLOOM.earth.strength, settle);
        bloom.radius = lerp(BLOOM.solar.radius, BLOOM.earth.radius, settle);
        bloom.threshold = lerp(BLOOM.solar.threshold, BLOOM.earth.threshold, settle);
        st.earthArrive = lerp(0.94, 1, 1 - Math.pow(1 - (tt - A) / (1 - A), 2.2));
      }
    } else if (T.mode === 'galaxyDive') {
      /* 银河系 → 太阳系：朝猎户臂上太阳的位置一路放大冲进去，最后穿过隧道换成太阳系 */
      const A = T.swapAt;
      tunnelMat.uniforms.uT.value = tt;
      if (tt < A) {
        // 用速度积分得到的 P(tt) 驱动放大：起步慢、中段越来越快、临近目标刹车
        const pAll = cinemaP(tt);
        const pSwap = cinemaP(A);
        const k = Math.min(1, pAll / Math.max(pSwap, 1e-4));
        st.galaxyDive = k;
        // 星云在 3–10s 之间慢慢淡出，把视野收拢成纯深空
        st.nebFade = smoothstep(0.10, 0.62, k);
        // 这一段是真三维的星际穿越，不再叠 2D 隧道，避免糊一层灰
        tunnelMat.uniforms.uA.value = 0;
        veilMat.opacity = 0;
        flashMat.opacity = 0;
        warpMat.uniforms.uT.value = 0;
        st.clean = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          applyScene('solar');
          st.galaxyDive = 0;
          st.nebFade = 1;
          // 先停在远处：太阳此时还不可见，只有行星与星空
          st.solarArrive = 1.55;
          st.sunReveal = 0;
          st.earthReveal = 0;
        }
        const k = (tt - A) / (1 - A);
        // 13–15s：减速收尾，镜头几乎停住，让八大行星完整呈现在画面里
        st.solarArrive = lerp(1.55, 1, 1 - Math.pow(1 - k, 2.2));
        // 只剩最后 0.5 秒时太阳才点亮：由小到大、由暗到亮
        const remain = (1 - tt) * T.dur;
        // 太阳：从「几乎没有」一路长到最后，不是等到末尾才点亮
        const rv = clamp(k, 0, 1);
        st.sunReveal = rv * rv * (3 - 2 * rv);
        // 地球的「亮起来」更晚一步：只留最后 0.15 秒
        const rvE = clamp(1 - remain / 0.15, 0, 1);
        st.earthReveal = rvE * rvE * (3 - 2 * rvE);
        st.clean = smoothstep(0.15, 0.85, k);
        tunnelMat.uniforms.uA.value = 0;
        // 切镜那一瞬用极短的一次「抵达闪光」盖住尺度跳变 —— 不是整段白闪
        flashMat.opacity = 0.34 * Math.exp(-Math.pow(((tt - A) * T.dur) / 0.11, 2));
      }
    } else if (T.mode === 'emerge') {
      /* 地球 → 银河系：地球先缩成一个亮点，再从那个点里把整片银河长出来 */
      const A = T.swapAt;
      tunnelMat.uniforms.uT.value = tt;
      if (tt < A) {
        const k = tt / A;
        st.earthOut = easeIO(k);
        tunnelMat.uniforms.uA.value = smoothstep(0.62, 1.0, k) * 0.9;
        flashMat.opacity = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          applyScene('galaxy');
          st.earthOut = 0;
          st.intro = 0;
        }
        const k = (tt - A) / (1 - A);
        st.intro = easeIO(Math.min(1, k / 0.82));
        tunnelMat.uniforms.uA.value = (1 - Math.min(1, k * 2.6)) * 0.9;
        flashMat.opacity = 0.40 * Math.exp(-Math.pow(((tt - A) * T.dur) / 0.13, 2));
      }
    } else if (T.mode === 'galaxyEarth') {
      /* 银河系 → 地球：先朝着银盘里的太阳位一路冲进去，穿过隧道后地球从光点推到眼前 */
      const A = T.swapAt;
      tunnelMat.uniforms.uT.value = tt;
      if (tt < A) {
        const k = tt / A;
        st.galaxyDive = easeIO(k);
        // 一头扎进核心会整块发白，提前压一点泛光、加一层暗角
        bloom.strength = BLOOM.galaxy.strength * (1 - 0.42 * k);
        tunnelMat.uniforms.uA.value = smoothstep(0.38, 0.96, k) * 0.92;
        veilMat.opacity = Math.min(0.5, smoothstep(0.42, 1.0, k) * 0.5);
        flashMat.opacity = 0;
        warpMat.uniforms.uT.value = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          applyScene('earth');
          st.galaxyDive = 0;
          st.earthArrive = 0.62;
        }
        const k = (tt - A) / (1 - A);
        st.earthArrive = lerp(0.62, 1, easeIO(Math.pow(k, 0.82)));
        tunnelMat.uniforms.uA.value = (1 - Math.min(1, k * 3.6)) * 0.86;
        veilMat.opacity = Math.max(0, 1 - k * 3.2) * 0.3;
        flashMat.opacity = 0.46 * Math.exp(-Math.pow(((tt - A) * T.dur) / 0.14, 2));
      }
    } else if (T.mode === 'earthSolar') {
      /* 地球 → 太阳系：地球后退缩成一个亮点，再从亮点里把太阳系拉开 */
      const A = T.swapAt;
      tunnelMat.uniforms.uT.value = tt;
      if (tt < A) {
        const k = tt / A;
        st.earthOut = easeIO(k);
        tunnelMat.uniforms.uA.value = smoothstep(0.48, 1.0, k) * 0.9;
        veilMat.opacity = Math.min(0.38, smoothstep(0.56, 1.0, k) * 0.38);
        flashMat.opacity = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          applyScene('solar');
          st.earthOut = 0;
          st.solarArrive = 0.42;
        }
        const k = (tt - A) / (1 - A);
        st.solarArrive = lerp(0.42, 1, easeIO(Math.pow(k, 0.8)));
        tunnelMat.uniforms.uA.value = (1 - Math.min(1, k * 2.8)) * 0.9;
        veilMat.opacity = Math.max(0, 1 - k * 3.0) * 0.28;
        flashMat.opacity = 0.40 * Math.exp(-Math.pow(((tt - A) * T.dur) / 0.13, 2));
      }
    } else if (T.mode === 'solarGalaxy') {
      /* 太阳系 → 银河系：整片太阳系缩成一颗粒，再从这颗粒里张开银河 */
      const A = T.swapAt;
      tunnelMat.uniforms.uT.value = tt;
      if (tt < A) {
        const k = tt / A;
        st.solarArrive = lerp(1, 7.0, Math.pow(k, 1.7));
        tunnelMat.uniforms.uA.value = smoothstep(0.44, 1.0, k) * 0.92;
        veilMat.opacity = Math.min(0.42, smoothstep(0.55, 1.0, k) * 0.42);
        flashMat.opacity = 0;
      } else {
        if (!T.swapped) {
          T.swapped = true;
          applyScene('galaxy');
          st.solarArrive = 1;
          st.intro = 0;
        }
        const k = (tt - A) / (1 - A);
        st.intro = easeIO(Math.min(1, k / 0.80));
        tunnelMat.uniforms.uA.value = (1 - Math.min(1, k * 2.7)) * 0.92;
        veilMat.opacity = Math.max(0, 1 - k * 3.0) * 0.32;
        flashMat.opacity = 0.42 * Math.exp(-Math.pow(((tt - A) * T.dur) / 0.13, 2));
      }
    } else if (T.mode === 'intro') {
      /* 加载页 → 银河系：穿过隧道，银河从中心张开 */
      const k = tt;
      tunnelMat.uniforms.uT.value = k;
      st.intro = easeIO(Math.min(1, Math.max(0, (k - 0.06) / 0.78)));
      const inA = smoothstep(0.0, 0.10, k);
      const outA = 1 - smoothstep(0.52, 0.92, k);
      tunnelMat.uniforms.uA.value = inA * outA * 0.95;
      // 银河长出来的时候把标题淡掉，别压在星核上
      warpLabel.style.opacity = String(Math.max(0, 1 - smoothstep(0.30, 0.56, k)));
      flashMat.opacity = 0.24 * Math.exp(-Math.pow((k - 0.60) / 0.042, 2));
      veilMat.opacity = 0;
    } else {
      warpMat.uniforms.uT.value = tt;
      veilMat.opacity = Math.min(0.82, Math.sin(tt * Math.PI) * 0.9);
      flashMat.opacity = 0;
      st.earthArrive = 1;
      if (!T.swapped && tt >= T.swapAt) {
        T.swapped = true;
        applyScene(T.to);
      }
    }

    if (T.t >= 1) {
      T.active = false;
      document.body.classList.remove('cinema');
      cooldown = 0.9;
      document.body.classList.remove('is-busy');
      warpLabel.classList.remove('show');
      warpLabel.style.opacity = '';
      warpMat.uniforms.uT.value = 0;
      veilMat.opacity = 0;
      flashMat.opacity = 0;
      tunnelMat.uniforms.uA.value = 0;
      st.dive = 0;
      st.earthArrive = 1;
      st.galaxyDive = 0;
      st.solarArrive = 1;
      st.earthOut = 0;
      st.intro = 1;
    }
  } else {
    /* --------- 缩放阈值触发转场 --------- */
    if (cooldown <= 0 && level === 'galaxy' && st.dolly >= 0.995) {
      beginTransition('solar');
    }
  }

  dollyNow = clamp(dollyNow, 0, 1);

  /* --------- 推拉做一点时间常数很小的平滑：滚轮是离散的，掌心深度也会跳 --------- */
  if (!T.active) {
    const kz = 1 - Math.exp(-dt / 0.085);
    dollyNow += (dollyTarget - dollyNow) * kz;
    dollyNow = clamp(dollyNow, 0, 1);
  }

  /* --------- 无操作时缓慢自转，保持画面灵动 --------- */
  if (!T.active) {
    if (currentKey === 'galaxy') st.yaw += dt * 0.008;
    if (currentKey === 'solar') st.yaw += dt * 0.014;
  }

  /* --------- 场景更新与渲染 --------- */
  /* 侧向扫视时给相机一点滚转（banking），画面不再是「平面平移」，
     而像真的绕着天体飞。滚转量取 yaw 的角速度，很小，只负责纵深感。 */
  const dyaw = st.yaw - prevYaw;
  prevYaw = st.yaw;
  const rollT = clamp((-dyaw / Math.max(dt, 0.001)) * 0.010, -0.075, 0.075);
  rollNow += (rollT - rollNow) * (1 - Math.exp(-dt / 0.16));
  const camNow = active.camera;
  if (Math.abs(rollNow) > 1e-4) {
    camNow.up.set(Math.sin(rollNow), Math.cos(rollNow), 0);
  } else if (camNow.up.y !== 1) {
    camNow.up.set(0, 1, 0);
  }

  active.update(dt, st);
  // 靠近主体时压低泛光，避免整屏发白（各场景可自报系数）
  if (!T.active && active.bloomScale) {
    bloom.strength = BLOOM[active.name].strength * active.bloomScale();
  }
  composer.render();

  /* --------- 曲速叠加层 --------- */
  if (T.active) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(veilScene, warpCam);
    if (tunnelMat.uniforms.uA.value > 0.002) renderer.render(tunnelScene, warpCam);
    if (flashMat.opacity > 0.002) renderer.render(flashScene, warpCam);
    if (warpMat.uniforms.uT.value > 0.0001) renderer.render(warpScene, warpCam);
    renderer.autoClear = true;
  }

  /* --------- UI --------- */
  updateLabels();
  // 进度条与提示文字按 ~12Hz 刷新就够了：每帧写 width/textContent 会不停触发排版
  uiAcc += dt;
  if (uiAcc >= 0.08) {
    uiAcc = 0;
    const pct = currentKey === 'earth' ? (st.dolly / 0.55) * 100 : st.dolly * 100;
    zoomFill.style.width = `${clamp(pct, 0, 100)}%`;

    // 层级 3/4 由 setLevel 写死文案，这里不要再覆盖
    if (level === 'selector' || level === 'detail') {
      /* keep */
    } else if (!G.present && !mouseMode && !T.active) {
      gestureText.textContent = '等待手部进入画面…';
    } else if (!mouseMode) {
      gestureText.textContent =
        G.gesture === 'open' ? '识别：张开手掌 · 推进放大'
        : G.gesture === 'fist' ? '识别：握拳 · 缩小'
        : G.gesture === 'pinch' ? '识别：捏合'
        : GESTURE_HINT[currentKey][0];
    } else {
      gestureText.textContent = GESTURE_HINT[currentKey][0] + '（鼠标拖拽 / 滚轮可用）';
    }
  }

  /* --------- 帧率自适应的分辨率 --------- */
  if (LOD_ENABLED) updateLod(rawMs);
}

/* 低帧率时降渲染分辨率、回稳后再慢慢升回来。
   切标签页回来那一帧的 rawMs 是几百毫秒，不能算进去。 */
function updateLod(rawMs) {
  if (rawMs > 250) return;
  lodAcc += rawMs;
  lodN++;
  if (lodN < 48) return;
  const avg = lodAcc / lodN;
  lodAcc = 0;
  lodN = 0;
  if (lodHold > 0) {
    lodHold--;
    return;
  }
  if (avg > 23.5 && qualityScale > QUALITY_FLOOR) {
    qualityScale = Math.max(QUALITY_FLOOR, qualityScale - 0.14);
    applyQuality();
    lodHold = 45;
  } else if (avg < 15.0 && qualityScale < QUALITY_CEIL) {
    qualityScale = Math.min(QUALITY_CEIL, qualityScale + 0.07);
    applyQuality();
    lodHold = 90;
  }
}

/* =========================================================
   Resize
   ========================================================= */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  Object.values(SCENES).forEach((s) => s.resize(w, h));
}
window.addEventListener('resize', onResize);

/* =========================================================
   启动
   ========================================================= */
function boot() {
  onResize();
  renderHUD('galaxy');
  applyScene('galaxy');
  buildLabels();
  buildPlanetNav();
  warmUp();
  tick();
}

/* 预热：三个场景的着色器与贴图各过一遍 GPU。
   不这么做的话，第一次切到地球场景那一帧要现场编译 shader + 上传 4K 贴图，
   表现就是转场末尾卡一下。 */
function warmUp() {
  const rt = new THREE.WebGLRenderTarget(4, 4);
  const prevTarget = renderer.getRenderTarget();
  [SCENES.galaxy, SCENES.solar, SCENES.earth].forEach((s) => {
    if (!s) return;
    renderer.setRenderTarget(rt);
    renderer.render(s.scene, s.camera);
  });
  renderer.setRenderTarget(prevTarget);
  rt.dispose();
}

// URL 调试：?scene=solar / earth（在 boot() 之后同步切，避免和首帧抢时序）
function applySceneFromURL() {
  const sp = new URLSearchParams(location.search);
  const q = sp.get('scene');
  if (q && SCENES[q] && q !== 'galaxy') applyScene(q);
  // 调试：直接落到某个层级
  // 调试：直接给定进场进度（模拟银河→太阳系转场中途的太阳）
  const ar = parseFloat(sp.get('arrive') || '');
  if (!Number.isNaN(ar)) st.solarArrive = clamp(ar, 0, 1);
  // 调试：脚本化一次左/右滑动，用来验证层级 3 的滑动判定
  if (sp.get('simswipe')) {
    const dir = sp.get('simswipe') === 'right' ? 1 : -1;
    setTimeout(() => { simSwipe = { t: 0, dir }; }, 1500);
  }
  // 调试：自动跑一次「太阳系 → 行星选择」动画，验证链路
  if (sp.get('flow') === 'selector') setTimeout(() => beginFocus('toSelector'), 1200);
  const lv = sp.get('level');
  if (lv && ['selector', 'detail'].includes(lv)) {
    const f = clamp(parseInt(sp.get('focus') || '4', 10) || 0, 0, 7);
    st.focus = f;
    st.focusPrev = f;
    st.focusBlend = 1;
    st.focusAmt = 1;
    st.detailAmt = lv === 'detail' ? 1 : 0;
    setLevel(lv);
  }
}

enterBtn.addEventListener('click', () => {
  hideLoader();
  setTimeout(() => {
    loaderEl.style.display = 'none';
  }, 950);
  boot();
  applySceneFromURL();
  audio.start();
  beginIntro();
  startCamera();
});

// 自动化/演示模式：?auto=1 直接进入（无摄像头）
const PARAMS = new URLSearchParams(location.search);
if (PARAMS.has('auto')) {
  hideLoader();
  loaderEl.style.display = 'none';
  boot();
  applySceneFromURL();
  if (PARAMS.has('intro') || PARAMS.has('play')) {
    setTimeout(() => beginIntro(), 120);
  }
}

// 调试/自动化钩子
try { window.U = {
  renderer, composer, bloom,
  get fps() { return fpsNow; },
  SCENES,
  st,
  T,
  applyScene,
  beginTransition,
  beginIntro,
  audio,
  tracker,
  beginFocus,
  switchPlanet,
  setLevel,
  get level() { return level; },
  get focusIdx() { return st.focus; },
  get key() { return currentKey; },
  get tunnelA() { return tunnelMat.uniforms.uA.value; },
  get tunnelT() { return tunnelMat.uniforms.uT.value; },
  get active() { return active; },
}; } catch (err) { console.error('U init failed:', err && err.message); }
