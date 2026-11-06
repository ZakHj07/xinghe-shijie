import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ---------------- One Euro 滤波 ----------------
   低通强度随速度变化：手静止时压得很死（不抖），快速移动时自动放松（不拖影）。
   比固定系数的指数平滑更适合「手掌坐标 → 转视角」这种既要稳又要跟手的场合。 */
function makeEuro(minCutoff = 1.15, beta = 0.018, dCutoff = 1.0) {
  let x = null;
  let dx = 0;
  let tPrev = 0;
  const alphaOf = (cutoff, dt) => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };
  return {
    reset() { x = null; dx = 0; tPrev = 0; },
    filter(v, tMs) {
      const t = tMs / 1000;
      if (x === null) { x = v; tPrev = t; return v; }
      let dt = t - tPrev;
      if (!(dt > 0)) dt = 1 / 60;
      if (dt > 0.25) dt = 0.25;
      const dxRaw = (v - x) / dt;
      dx += alphaOf(dCutoff, dt) * (dxRaw - dx);
      const cutoff = minCutoff + beta * Math.abs(dx);
      x += alphaOf(cutoff, dt) * (v - x);
      tPrev = t;
      return x;
    },
  };
}

export function createHandTracker({ video, overlay }) {
  const state = {
    ready: false,
    present: false,
    gesture: 'none',      // none | open | fist | pinch
    stable: 0,            // 当前手势已经稳定保持了多久（毫秒）
    openness: 0,
    pinch: 1,
    palm: { x: 0.5, y: 0.5 },
    vel: { x: 0, y: 0 },
    landmarks: null,
    fps: 0,
  };

  let landmarker = null;
  let lastVideoTime = -1;
  let lastDetect = 0;
  // 隔帧识别：识别频率压到渲染帧率的 1/2，手势计算与渲染解耦，不抢主线程
  let detectTick = 0;
  const DETECT_EVERY = 2;
  let lastPalm = null;
  let lastDraw = 0;
  let lastDrawKey = '';
  let lastSeen = 0;
  let statusCb = () => {};
  const octx = overlay.getContext('2d');

  /* 滤波器：掌心 x / y 各一个，openness 与 pinch 各一个（后两个只用普通 EMA） */
  const fx = makeEuro(1.05, 0.020);
  const fy = makeEuro(1.05, 0.020);
  let openSmooth = 0;
  let pinchSmooth = 1;

  /* 手势防抖：候选手势要连续成立一段时间才真正切换，避免边界上疯狂跳变 */
  let cand = 'none';
  let candSince = 0;
  const GESTURE_HOLD_MS = 85;
  const PINCH_IN = 0.40;   // 进入捏合
  const PINCH_OUT = 0.52;  // 退出捏合（迟滞，防止在阈值上抖）

  function setStatus(text, cls) {
    statusCb(text, cls);
  }

  /* 画布分辨率跟「面板实际显示尺寸」对齐（含 dpr）。
     之前直接把画布设成视频原始分辨率，而 <video> 用的是 object-fit:cover ——
     视频被裁掉了左右两侧，画布却是整帧铺满，骨骼自然和手指错位。 */
  function syncOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round((overlay.clientWidth || 232) * dpr));
    const h = Math.max(1, Math.round((overlay.clientHeight || 174) * dpr));
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
      lastDrawKey = '';
    }
  }
  window.addEventListener('resize', syncOverlay, { passive: true });

  async function init(onStatus) {
    statusCb = onStatus || (() => {});
    setStatus('正在启动摄像头…', '');
    let stream;
    try {
      // 720p 起：640×480 时手离远一点关键点就会飘，分辨率是识别稳定度的第一道关
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
        audio: false,
      });
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
    } catch (err) {
      setStatus('摄像头不可用 · 鼠标模式', 'err');
      throw err;
    }
    if (video.readyState < 2) {
      await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
    }
    syncOverlay();

    setStatus('加载手势模型…', '');
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const common = {
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.55,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...common,
        baseOptions: { modelAssetPath: './vendor/mediapipe/hand_landmarker.task', delegate: 'GPU' },
      });
    } catch (e) {
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...common,
        baseOptions: { modelAssetPath: './vendor/mediapipe/hand_landmarker.task', delegate: 'CPU' },
      });
    }
    state.ready = true;
    setStatus('手势追踪已就绪', 'live');
    return true;
  }

  /* 单帧分类：用「指尖到腕 / 近节到腕」的比值判伸展，比单纯比长度更抗透视；
     拇指单独按与食指根的横向张开度判断。 */
  function classify(lm) {
    const wrist = lm[0];
    const midMcp = lm[9];
    const size = Math.max(dist(wrist, midMcp), 1e-4);

    const ext = (tip, pip) => dist(lm[tip], wrist) / Math.max(dist(lm[pip], wrist), 1e-4);
    // 阈值放在 1.07–1.10：握拳时指尖蜷回掌心，比值通常只有 0.75–0.95，
    // 留一点余量给「半张开」的手，避免要张到很夸张才识别
    const fingers = [
      ext(8, 6) > 1.10,
      ext(12, 10) > 1.09,
      ext(16, 14) > 1.08,
      ext(20, 18) > 1.07,
    ];
    const spread = dist(lm[4], lm[5]) / size;
    const thumbOut = spread > 0.62;
    const count = fingers.filter(Boolean).length + (thumbOut ? 1 : 0);
    const openness = clamp01(count / 5);
    const pinch = dist(lm[4], lm[8]) / size;

    const palm = {
      x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
      y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
      z: (lm[0].z + lm[5].z + lm[9].z + lm[13].z + lm[17].z) / 5,
    };
    return { gesture: 'none', openness, pinch, palm, count, fingers };
  }

  function pickGesture(info, now) {
    // 捏合用迟滞：已经捏住时要松到 PINCH_OUT 才算松开
    const wasPinch = state.gesture === 'pinch';
    let want = 'none';
    const pinchOn = wasPinch ? info.pinch < PINCH_OUT : info.pinch < PINCH_IN;
    if (pinchOn && info.count <= 3) want = 'pinch';
    else if (info.count <= 1) want = 'fist';
    else if (info.count >= 4) want = 'open';

    if (want !== cand) {
      cand = want;
      candSince = now;
    }
    const held = now - candSince;
    if (held >= GESTURE_HOLD_MS) {
      if (state.gesture !== cand) {
        state.gesture = cand;
        state.stable = 0;
      } else {
        state.stable = held;
      }
    }
    return state.gesture;
  }

  /* 视频归一化坐标 → 画布像素：复刻 <video> 的 object-fit:cover 裁剪，
     骨骼才会正好压在手指上（之前画布按整帧铺满，视频被裁过，于是整体错位）。 */
  function project(lm) {
    const cw = overlay.width;
    const ch = overlay.height;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const s = Math.max(cw / vw, ch / vh);
    const dw = vw * s;
    const dh = vh * s;
    const ox = (cw - dw) * 0.5;
    const oy = (ch - dh) * 0.5;
    return lm.map((p) => ({ x: ox + p.x * dw, y: oy + p.y * dh }));
  }

  function draw(lm) {
    syncOverlay();
    const w = overlay.width;
    const h = overlay.height;
    // 关键点没怎么动就不重画，省一次开销
    const key = lm
      ? lm.map((p) => ((p.x * 240) | 0) + ',' + ((p.y * 240) | 0)).join(';')
      : 'none';
    if (key === lastDrawKey) return;
    lastDrawKey = key;

    octx.clearRect(0, 0, w, h);
    if (!lm) return;

    const pts = project(lm);
    octx.lineWidth = Math.max(1.6, w / 300);
    octx.lineJoin = 'round';
    octx.lineCap = 'round';
    octx.strokeStyle = 'rgba(95,230,255,0.88)';
    octx.shadowColor = 'rgba(95,230,255,0.9)';
    octx.shadowBlur = Math.max(4, w / 90);
    CONNECTIONS.forEach(([a, b]) => {
      octx.beginPath();
      octx.moveTo(pts[a].x, pts[a].y);
      octx.lineTo(pts[b].x, pts[b].y);
      octx.stroke();
    });
    octx.shadowBlur = 0;
    const dotR = Math.max(1.9, w / 300);
    octx.fillStyle = 'rgba(255,255,255,0.95)';
    pts.forEach((p) => {
      octx.beginPath();
      octx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      octx.fill();
    });
    // 指尖高亮
    const tipR = Math.max(2.8, w / 170);
    octx.fillStyle = 'rgba(255,210,120,0.95)';
    [4, 8, 12, 16, 20].forEach((i) => {
      octx.beginPath();
      octx.arc(pts[i].x, pts[i].y, tipR, 0, Math.PI * 2);
      octx.fill();
    });
  }

  function update(now) {
    if (!landmarker || video.readyState < 2 || document.hidden) return state;
    // 30Hz 足够：MediaPipe 跑得更快只会白烧 CPU，相机本来也就 30 帧
    if (now - lastDetect < 30) return state;
    detectTick = (detectTick + 1) % DETECT_EVERY;
    if (detectTick !== 0) return state;
    if (video.currentTime === lastVideoTime) return state;
    lastDetect = now;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = landmarker.detectForVideo(video, now);
    } catch (e) {
      return state;
    }
    const lm = result && result.landmarks && result.landmarks[0];

    if (lm) {
      const info = classify(lm);
      lastSeen = now;

      const px = fx.filter(info.palm.x, now);
      const py = fy.filter(info.palm.y, now);
      if (lastPalm) {
        state.vel.x = (px - lastPalm.x) * 0.8 + state.vel.x * 0.2;
        state.vel.y = (py - lastPalm.y) * 0.8 + state.vel.y * 0.2;
      } else {
        state.vel.x = 0;
        state.vel.y = 0;
      }
      lastPalm = { x: px, y: py };

      openSmooth += (info.openness - openSmooth) * 0.3;
      pinchSmooth += (info.pinch - pinchSmooth) * 0.3;

      state.present = true;
      state.palm.x = px;
      state.palm.y = py;
      state.openness = openSmooth;
      state.pinch = pinchSmooth;
      state.landmarks = lm;
      pickGesture({ ...info, pinch: pinchSmooth }, now);

      if (now - lastDraw > 33) {
        lastDraw = now;
        draw(lm);
      }
    } else {
      // 手短暂丢失（转身、出画一点点）时先别急着停：保持 220ms，避免缩放一卡一卡
      const lost = now - lastSeen;
      if (lost > 220) {
        state.present = false;
        state.gesture = 'none';
        state.stable = 0;
        state.openness = 0;
        state.vel.x *= 0.82;
        state.vel.y *= 0.82;
        state.landmarks = null;
        lastPalm = null;
        fx.reset(); fy.reset();
        cand = 'none';
        if (lastDrawKey !== 'none') {
          lastDrawKey = 'none';
          octx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }
    }
    return state;
  }

  return { state, init, update, _draw: draw, _project: project };
}