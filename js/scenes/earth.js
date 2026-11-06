import * as THREE from 'three';
import { GLSL_NOISE, makeGlowTexture } from '../util.js';
import { createEarthSurface, createCloudShell, createAtmoShell } from '../earthmat.js';
import { createPlanetMaterial } from '../planetmat.js';

export function createEarth(pixelRatio, tex) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 6000);

  /* ---------------- 地球 ---------------- */
  const root = new THREE.Group();          // 手势控制（四元数）
  const tilt = new THREE.Group();          // 23.4° 轴倾角
  tilt.rotation.z = THREE.MathUtils.degToRad(23.4);
  root.add(tilt);
  scene.add(root);

  // 天空转轴：背景（星云穹顶 / 星点 / 太阳 / 其他行星）挂在它上面，
  // 转动地球时它按较小比例跟着转 —— 近处的球转得多、远处的天转得少，就有了视差。
  const skyPivot = new THREE.Group();
  scene.add(skyPivot);

  const sunDir = new THREE.Vector3(0.46, 0.20, 0.86).normalize();

  const surface = createEarthSurface({
    day: tex.earthDay,
    night: tex.earthNight,
    water: tex.earthWater,
    radius: 1,
    segments: 160,
    sunDir,
    nightGain: 1.15,
  });
  const earth = surface.mesh;
  tilt.add(earth);

  const cloudShell = createCloudShell({
    clouds: tex.earthClouds,
    radius: 1,
    segments: 128,
    sunDir,
    opacity: 0.95,
  });
  const clouds = cloudShell.mesh;
  clouds.rotation.y = 0.35;
  tilt.add(clouds);

  const atmoShell = createAtmoShell({ radius: 1, segments: 96, sunDir, color: 0x5aa9ff, strength: 0.65 });
  const atmo = atmoShell.mesh;
  root.add(atmo);

  /* ---------------- 光源 ---------------- */
  // 地表/云层/大气都是自绘 shader，只认 uniforms.uSunDir，不参与场景灯光。
  // 这里不再放真实灯光，太阳只以一个远处的亮点出现。

  // 远处的太阳（光源可见）
  const glowTex = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,220,170,0.8)'));
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const farSun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  farSun.position.copy(sunDir.clone().multiplyScalar(420));
  farSun.scale.set(60, 60, 1);
  skyPivot.add(farSun);

  /* ---------------- 地球专属背景：冷调深空 ---------------- */
  const skyUniforms = { uTime: { value: 0 }, uSun: { value: sunDir.clone() } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 56, 36),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3 uSun;
        ${GLSL_NOISE}
        void main(){
          vec3 d = normalize(vDir);
          float t = uTime * 0.030;

          // 冷调：靛蓝底 + 青蓝丝状云气。刻意压得很暗、很稀薄，
          // 把画面里最亮的位置留给地球，避免背景「抢戏」。
          vec3 q1 = vec3(d.x * 7.5 + t * 0.9, d.y * 11.0, d.z * 7.5 - t * 0.6);
          float n1 = fbm5(q1);
          vec3 q2 = vec3(d.x * 16.0 - t * 0.6, d.y * 24.0, d.z * 16.0 + t * 0.35);
          float n2 = fbm3(q2);

          float fil = smoothstep(0.54, 0.96, n1 * 0.78 + n2 * 0.42);
          float glow = pow(fil, 2.2);

          // 银河带：把云气收在这一条上，其余留干净的深空，避免整片天空发灰发棕
          float band = smoothstep(0.02, 0.95, 1.0 - abs(d.y * 1.30 + 0.10 * sin(d.x * 2.0 + t * 0.5)));
          float bandCool = smoothstep(0.28, 1.0, band);

          vec3 cDeep = vec3(0.0016, 0.0032, 0.0078);
          vec3 cBlue = vec3(0.0110, 0.0400, 0.1180);
          vec3 cCyan = vec3(0.0055, 0.0540, 0.0860);
          vec3 cTeal = vec3(0.0035, 0.0290, 0.0430);

          vec3 col = cDeep;
          col += cBlue * (0.08 * glow + 0.022) * bandCool;
          col = mix(col, cCyan, smoothstep(0.78, 1.0, n2) * 0.07 * bandCool);
          col += cTeal * pow(smoothstep(0.76, 1.0, n2 * 0.55 + n1 * 0.45), 2.2) * 0.12 * bandCool;

          // 太阳那一侧的暖边：收到 14 次方，只在朝阳处留一条极窄的暖色，
          // 否则转过头整片天会变成一层土棕色
          float sunAmt = pow(max(dot(d, normalize(uSun)), 0.0), 14.0);
          col += vec3(0.090, 0.064, 0.042) * sunAmt * 0.30;

          // 极细星尘
          float sp = pow(fbm3(d * 120.0 + vec3(uTime * 0.015)), 8.0);
          col += vec3(0.80, 0.90, 1.0) * sp * 0.030;

          col *= 0.60 + bandCool * 0.40;
          col *= 0.92;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.renderOrder = -10;
  skyPivot.add(sky);

  // 近景星点（三层，铺满全天 + 一条倾斜星带，随机闪烁、随视角视差转动）
  const stars = [];
  for (let L = 0; L < 3; L++) {
    const count = [1500, 1100, 760][L];
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const R = [300, 720, 1500][L];
    for (let i = 0; i < count; i++) {
      const rr = R * (0.92 + Math.random() * 0.16);
      let px, py, pz;
      if (Math.random() < 0.46) {
        // 斜向星带：让背景有「银河带」的走向，而不是均匀噪点
        const ang = Math.random() * Math.PI * 2;
        px = Math.cos(ang) * rr;
        py = (Math.random() - 0.5) * R * 0.18;
        pz = Math.sin(ang) * rr;
        const tilt = 0.46, cy = Math.cos(tilt), sy = Math.sin(tilt);
        const ny = py * cy - pz * sy;
        const nz = py * sy + pz * cy;
        py = ny; pz = nz;
      } else {
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const sq = Math.sqrt(1 - u * u);
        px = rr * sq * Math.cos(phi);
        py = rr * u;
        pz = rr * sq * Math.sin(phi);
      }
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
      const b = 0.13 + Math.pow(Math.random(), 2.9) * 0.62;
      const warm = Math.random() < 0.12;
      col[i * 3] = b * (warm ? 1.0 : 0.84 + Math.random() * 0.14);
      col[i * 3 + 1] = b * (warm ? 0.84 : 0.91 + Math.random() * 0.09);
      col[i * 3 + 2] = b * (warm ? 0.66 : 0.98 + Math.random() * 0.02);
      size[i] = 0.5 + Math.pow(Math.random(), 4.2) * 2.3;
      phase[i] = Math.random() * 6.2831;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uPixelRatio; uniform float uTime;
        varying vec3 vColor; varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uPixelRatio * 1.45, 0.7, 4.6 * uPixelRatio);
          vColor = aColor;
          float sp = 0.5 + fract(aPhase * 0.159) * 1.1;
          vTw = 0.55 + 0.45 * sin(uTime * sp + aPhase);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor, pow(1.0 - d, 2.3) * vTw);
        }
      `,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = -5 + L;
    skyPivot.add(p);
    stars.push({ points: p, mat: m, speed: [0.004, 0.007, 0.011][L] });
  }

  /* ---------------- 背景里的其他行星 ---------------- */
  // 太阳系视角：从远处看这些行星，只是天幕上的小圆面。
  // 它们挂在 skyPivot 上，所以地球转动时会跟着缓慢平移（视差），
  // 并且始终用同一个太阳方向着色，晨昏线和地球对得上。
  const bgPlanets = [];
  const BG_LIST = [
    { key: 'mercury', map: tex.mercury, r: 3.0, dist: 330, az: 18, el: -20, atmo: 0x2a2622, rim: 0.06, spec: 0.04, relief: 0.85, contrast: 0.10 },
    { key: 'venus', map: tex.venus, r: 5.2, dist: 362, az: -10, el: -22, atmo: 0xd9c08a, rim: 0.28, spec: 0.06, relief: 0.18, contrast: -0.04 },
    { key: 'mars', map: tex.mars, r: 4.4, dist: 402, az: 12, el: 20, atmo: 0xc98a6a, rim: 0.12, spec: 0.04, relief: 0.62, contrast: 0.05 },
    { key: 'jupiter', map: tex.jupiter, r: 11.5, dist: 470, az: 22, el: 10, atmo: 0xd8c3a5, rim: 0.12, spec: 0.03, relief: 0.18, contrast: 0.05 },
    { key: 'saturn', map: tex.saturn, r: 9.6, dist: 512, az: 27, el: -12, atmo: 0xd8c9a8, rim: 0.12, spec: 0.03, relief: 0.14, contrast: 0.04, ring: true },
    { key: 'uranus', map: tex.uranus, r: 6.6, dist: 556, az: -52, el: 14, atmo: 0x8fd6e8, rim: 0.22, spec: 0.05, relief: 0.10, contrast: 0.0 },
    { key: 'neptune', map: tex.neptune, r: 6.2, dist: 596, az: 58, el: -8, atmo: 0x6aa6e8, rim: 0.20, spec: 0.05, relief: 0.10, contrast: 0.0 },
    // 月球放在反方向：转过半圈之后不至于只剩一片空天
    { key: 'moon', map: tex.moon, r: 9.2, dist: 320, az: -96, el: 26, atmo: 0x000000, rim: 0.0, spec: 0.0, relief: 0.55, contrast: 0.02 },
  ];

  BG_LIST.forEach((p) => {
    if (!p.map) return;
    const pm = createPlanetMaterial({
      map: p.map,
      atmo: p.atmo,
      rim: p.rim,
      spec: p.spec,
      relief: p.relief,
      contrast: p.contrast,
      sunDir,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, 40, 28), pm.material);
    mesh.name = 'bg:' + p.key;
    const az = THREE.MathUtils.degToRad(p.az);
    const el = THREE.MathUtils.degToRad(p.el);
    mesh.position.set(
      Math.sin(az) * Math.cos(el) * p.dist,
      Math.sin(el) * p.dist,
      -Math.cos(az) * Math.cos(el) * p.dist
    );
    mesh.renderOrder = -4;

    if (p.ring && tex.ring) {
      // 环贴图是一张 2048×125 的「径向剖面」条带，必须把 UV 的 u 映射成半径，
      // 否则会变成一块方板子。
      const rIn = p.r * 1.32;
      const rOut = p.r * 2.28;
      const rg = new THREE.RingGeometry(rIn, rOut, 72, 2);
      const rp = rg.attributes.position;
      const ruv = rg.attributes.uv;
      for (let i = 0; i < rp.count; i++) {
        const rr = Math.hypot(rp.getX(i), rp.getY(i));
        ruv.setXY(i, (rr - rIn) / (rOut - rIn), 0.5);
      }
      const ring = new THREE.Mesh(
        rg,
        new THREE.MeshBasicMaterial({
          map: tex.ring,
          transparent: true,
          side: THREE.DoubleSide,
          opacity: 0.78,
          depthWrite: false,
          color: 0xd9cfb6,
          toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = THREE.MathUtils.degToRad(26);
      mesh.add(ring);
    }

    skyPivot.add(mesh);
    bgPlanets.push({ mesh, uniforms: pm.uniforms, base: p });
  });

  /* ---------------- 更新 ---------------- */
  let t = 0;
  // 增量四元数：不靠 yaw/pitch 直接拼欧拉角，才能无死角地转满 360°
  const AXIS_Y = new THREE.Vector3(0, 1, 0);
  const AXIS_X = new THREE.Vector3(1, 0, 0);
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  let lastYaw = 0;
  let lastPitch = 0;
  const SKY_FOLLOW = 0.42;   // 天空跟随手势的比例（近处转 1，远处只转 0.42 → 视差）

  const state = {
    name: 'earth',
    scene,
    camera,
    root,
    resetOrientation() {
      root.quaternion.identity();
      skyPivot.quaternion.identity();
      lastYaw = 0;
      lastPitch = 0;
    },
    update(dt, st) {
      t += dt;
      skyUniforms.uTime.value = t;

      // 自转
      earth.rotation.y += dt * 0.055;
      clouds.rotation.y += dt * 0.072;

      // 手势姿态：把「本帧 yaw/pitch 的增量」作为世界轴增量转上去，
      // 这样连续拖多少圈都不会被 ±90° 卡住，也不会出现欧拉角的翻滚。
      let dyaw = st.yaw - lastYaw;
      let dpitch = st.pitch - lastPitch;
      lastYaw = st.yaw;
      lastPitch = st.pitch;
      // 切场景时 yaw/pitch 会被重置，这一帧的大跳变要丢掉（正常手势每帧远小于 3 rad）
      if (Math.abs(dyaw) > 3.0) dyaw = 0;
      if (Math.abs(dpitch) > 3.0) dpitch = 0;

      if (dyaw || dpitch) {
        qA.setFromAxisAngle(AXIS_Y, dyaw);
        qB.setFromAxisAngle(AXIS_X, dpitch);
        root.quaternion.premultiply(qA).premultiply(qB);
        qA.setFromAxisAngle(AXIS_Y, dyaw * SKY_FOLLOW);
        qB.setFromAxisAngle(AXIS_X, dpitch * SKY_FOLLOW);
        skyPivot.quaternion.premultiply(qA).premultiply(qB);
      }

      stars.forEach((s) => { s.mat.uniforms.uTime.value = t; s.points.rotation.y += dt * s.speed; });

      const e = Math.pow(st.dolly, 1.15);
      // earthArrive：转场刚落地时 < 1，镜头贴近地球再缓缓拉开，衔接太阳系的俯冲
      const arrive = st.earthArrive == null ? 1 : st.earthArrive;
      // 交接瞬间用「俯冲末帧」的视角参数（2.05 倍半径 / 38°），保证切过来的那一帧
      // 尺寸、视场完全一致；随后再随 arrive 平滑回到常规取景
      const settle = THREE.MathUtils.clamp((arrive - 0.60) / 0.40, 0, 1);
      const eased = settle * settle * (3 - 2 * settle);
      // earthOut：升空回银河时，镜头先快速后退，把地球缩成一个光点
      const out = st.earthOut || 0;
      const dist = THREE.MathUtils.lerp(3.05, 2.55, e) * arrive * (1 + out * 26);
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      camera.fov = THREE.MathUtils.lerp(38, THREE.MathUtils.lerp(43, 50, e), eased);
      camera.updateProjectionMatrix();
      // 轴倾角也跟着补间：俯冲过来的地球没有倾角，落地后慢慢立起来
      tilt.rotation.z = THREE.MathUtils.degToRad(23.4) * eased;
    },
    // 太阳系俯冲结束时把「那一刻的太阳方向 / 机位方向 / 地球自转角」接过来
    adoptHandoff(h) {
      if (h && h.sunDir) {
        sunDir.copy(h.sunDir).normalize();
        surface.uniforms.uSunDir.value.copy(sunDir);
        cloudShell.uniforms.uSunDir.value.copy(sunDir);
        atmoShell.uniforms.uSunDir.value.copy(sunDir);
        skyUniforms.uSun.value.copy(sunDir);
        bgPlanets.forEach((p) => p.uniforms.uSunDir.value.copy(sunDir));
        farSun.position.copy(sunDir).multiplyScalar(420);
      }
      if (h && h.camDir) {
        // 让「正对镜头的那条经线」和太阳系里看到的一致
        earth.rotation.y = (h.yaw || 0) + Math.atan2(h.camDir.x, h.camDir.z);
        clouds.rotation.y = earth.rotation.y + 0.35;
      }
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
  return state;
}
