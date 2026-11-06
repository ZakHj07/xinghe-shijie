import * as THREE from 'three';
import { GLSL_NOISE, gauss, makeGlowTexture } from '../util.js';
import { createDeepField } from './deepfield.js';

/**
 * 粒子银河系：13 万颗星点组成的旋涡星系 + 程序化星云背景
 */
export function createGalaxy(pixelRatio) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uSize: { value: 1.0 },
    uDim: { value: 1.0 },
    uIntro: { value: 1.0 },
  };

  /* ---------------- 星系粒子 ---------------- */
  const N = 130000;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const seeds = new Float32Array(N);

  const cCore = new THREE.Color('#fff0c8');
  const cInner = new THREE.Color('#ffd9a0');
  const cMid = new THREE.Color('#bcd8ff');
  const cEdge = new THREE.Color('#4c6dff');
  const cPink = new THREE.Color('#ff5f8a');
  const tmp = new THREE.Color();

  for (let i = 0; i < N; i++) {
    let x, y, z, r, t;
    const i3 = i * 3;
    const isBulge = Math.random() < 0.09;

    if (isBulge) {
      r = Math.abs(gauss()) * 8.5 + 1.0;
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      x = r * s * Math.cos(phi);
      z = r * s * Math.sin(phi);
      y = r * u * 0.42;
      t = Math.min(1, r / 30);
    } else {
      const q = Math.pow(Math.random(), 0.62);
      r = 7 + q * 99;
      const arms = 2;
      const armIdx = Math.random() < 0.5 ? 0 : 1;
      const wobble = gauss() * (0.2 + r * 0.0016);
      const theta = Math.log(r / 7) * 2.2 + armIdx * Math.PI + wobble;
      const scatter = 1.7 + r * 0.019;
      x = Math.cos(theta) * r + gauss() * scatter;
      z = Math.sin(theta) * r + gauss() * scatter;
      y = gauss() * (5.6 - Math.min(r, 95) * 0.035);

      // 偶发的悬臂外延
      if (Math.random() < 0.02) {
        const ang = Math.random() * Math.PI * 2;
        x += Math.cos(ang) * gauss() * 6;
        z += Math.sin(ang) * gauss() * 6;
      }
      t = Math.min(1, (r - 7) / 99);
      t = Math.pow(t, 0.75);
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    if (t < 0.24) tmp.copy(cCore).lerp(cInner, t / 0.24);
    else if (t < 0.58) tmp.copy(cInner).lerp(cMid, (t - 0.24) / 0.34);
    else tmp.copy(cMid).lerp(cEdge, (t - 0.58) / 0.42);

    // 恒星形成区（HII 区）
    if (!isBulge && Math.random() < 0.075) tmp.lerp(cPink, 0.72 + Math.random() * 0.28);
    // 亮度随机化
    const lum = (isBulge ? 0.55 : 0.78) + Math.random() * 0.42;
    tmp.multiplyScalar(lum);

    colors[i3] = tmp.r;
    colors[i3 + 1] = tmp.g;
    colors[i3 + 2] = tmp.b;
    sizes[i] = (isBulge ? 0.9 : 0.55) + Math.pow(Math.random(), 3) * 2.6;
    seeds[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 160);

  const pointsMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSize;
      uniform float uIntro;
      varying vec3 vColor;
      varying float vSeed;
      void main(){
        vec3 p = position;
        float r = length(p.xz);
        float w = 0.34 / (1.4 + r * 0.055);
        float a = uTime * w;
        float c = cos(a), s = sin(a);
        p.xz = mat2(c, -s, s, c) * p.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 1.0);
        gl_PointSize = aSize * uSize * uPixelRatio * (250.0 / dist);
        gl_PointSize *= mix(0.34, 1.0, uIntro);
        // 俯冲穿过银盘时，粒子不能膨胀成一张张光斑：上限压到 6px 左右
        gl_PointSize = clamp(gl_PointSize, 0.6, 6.0 * uPixelRatio);
        vColor = aColor;
        vSeed = aSeed;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vSeed;
      uniform float uTime;
      uniform float uDim;
      uniform float uIntro;
      void main(){
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.4);
        float tw = 0.78 + 0.22 * sin(uTime * 2.4 + vSeed * 39.0);
        // 进场时星系整体被压成一个点，粒子必须同步变暗变小，否则加色混合会糊成一个白球
        vec3 col = vColor * (0.30 + 0.55 * core) * tw * uDim * mix(0.06, 1.0, uIntro);
        gl_FragColor = vec4(col, core * 0.70 * mix(0.22, 1.0, uIntro));
      }
    `,
  });

  const galaxyGroup = new THREE.Group();
  // 让银盘相对相机倾斜，形成 M51 那样的斜视角（而不是正侧对）
  galaxyGroup.rotation.set(-1.02, 0, 0.12);
  const points = new THREE.Points(geo, pointsMat);
  galaxyGroup.add(points);
  scene.add(galaxyGroup);

  /* ---------------- 星系核心辉光 ---------------- */
  const glowTex = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,214,150,0.75)'));
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const coreGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffe0b0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.42,
    })
  );
  coreGlow.scale.set(20, 20, 1);
  galaxyGroup.add(coreGlow);

  const coreGlow2 = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0x9fc3ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.12,
    })
  );
  coreGlow2.scale.set(120, 120, 1);
  scene.add(coreGlow2);

  /* ---------------- 背景星云穹顶 ---------------- */
  const nebulaUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uPlane: { value: new THREE.Vector3(0, 1, 0) },
  };
  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: nebulaUniforms,
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
      uniform float uOpacity;
      uniform vec3 uPlane;
      ${GLSL_NOISE}
      void main(){
        vec3 dir = normalize(vDir);

        // 域扭曲：把噪声扭成纤维/丝状，而不是一团团糊斑
        vec3 p = dir * 4.05 + vec3(uTime * 0.0045, uTime * 0.0022, -uTime * 0.0032);
        float w = fbm3(p * 1.55 + 7.0);
        vec3 q = p + vec3(w) * 0.52;

        float n1 = fbm3(q);
        float n2 = fbm3(q * 3.15 + 19.0);
        float n3 = fbm3(q * 7.2 - 9.0);

        // 尘埃带与银盘共面（uPlane 是银盘法线），背景和主体才不会各走各的
        float h = abs(dot(dir, uPlane));
        float band = exp(-h * h * 34.0);
        float halo = exp(-h * h * 3.2);

        vec3 cSky   = vec3(0.0021, 0.0048, 0.0128);
        vec3 cDust  = vec3(0.0190, 0.0380, 0.0760);
        vec3 cTeal  = vec3(0.0140, 0.0620, 0.1000);
        vec3 cAmber = vec3(0.0900, 0.0540, 0.0300);

        float fil = smoothstep(0.54, 0.96, n1);

        vec3 col = cSky;
        // 云雾压得很淡：参考片里天空是「干净的深色 + 密密麻麻的小星」，
        // 不是一团团发亮的星云，所以这里只留贴住银盘的薄雾与暗尘
        col += cDust * fil * (0.16 + 0.46 * band);
        col += cTeal * pow(smoothstep(0.60, 0.97, n2), 2.2) * (0.04 + 0.24 * band);
        col += cAmber * pow(smoothstep(0.64, 1.0, 1.0 - n2), 2.4) * band * 0.30;
        col += vec3(0.30, 0.40, 0.66) * pow(smoothstep(0.78, 0.998, n3), 3.2) * (0.06 + 0.28 * band);
        col += cDust * halo * 0.13;

        // 极细的星尘颗粒，负责「锐」—— 频率拉到 130，颗粒更小更密
        float sp = pow(fbm3(dir * 130.0 + vec3(uTime * 0.010)), 8.0);
        col += vec3(0.58, 0.72, 1.0) * sp * 0.30 * (0.55 + band);

        gl_FragColor = vec4(col * uOpacity, 1.0);
      }
    `,
  });
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(2600, 64, 44), nebulaMat);
  nebula.renderOrder = -10;
  scene.add(nebula);

  /* ---------------- 远景星场 ---------------- */
  const starN = 13000;
  const starPos = new Float32Array(starN * 3);
  const starCol = new Float32Array(starN * 3);
  const starSize = new Float32Array(starN);
  const starSeed = new Float32Array(starN);
  for (let i = 0; i < starN; i++) {
    const r = 1100 + Math.random() * 900;
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    starPos[i * 3] = r * s * Math.cos(phi);
    starPos[i * 3 + 1] = r * u * 0.8;
    starPos[i * 3 + 2] = r * s * Math.sin(phi);
    // 参考片里绝大多数是单像素小星，只有极少数亮星带衍射十字
    const b = 0.20 + Math.pow(Math.random(), 3.0) * 0.58;
    const roll = Math.random();
    let cr, cg, cb;
    if (roll < 0.55) { cr = 0.80; cg = 0.88; cb = 1.00; }        // 蓝白（B/A 型）
    else if (roll < 0.82) { cr = 1.00; cg = 0.97; cb = 0.93; }   // 白（F/G 型）
    else if (roll < 0.96) { cr = 1.00; cg = 0.82; cb = 0.62; }   // 暖橙（K/M 型）
    else { cr = 0.72; cg = 0.82; cb = 1.00; }                    // 偏蓝的亮星
    starCol[i * 3] = b * cr;
    starCol[i * 3 + 1] = b * cg;
    starCol[i * 3 + 2] = b * cb;
    starSize[i] = 0.40 + Math.pow(Math.random(), 6.5) * 2.1;
    starSeed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1));
  const bgStars = new THREE.Points(
    starGeo,
    new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uPixelRatio: uniforms.uPixelRatio },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aSeed;
        uniform float uTime; uniform float uPixelRatio;
        varying vec3 vColor; varying float vSeed; varying float vFlare;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, aSize * uPixelRatio * 3.4);
          vColor = aColor; vSeed = aSeed;
          vFlare = step(1.55, aSize);   // 只有最亮的几颗带十字衍射
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vSeed; varying float vFlare; uniform float uTime;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          // 锐利的小核 + 很淡的晕，避免一团糊
          float core = smoothstep(0.42, 0.0, d);
          float halo = pow(max(0.0, 1.0 - d), 3.2);
          float a = core * 0.78 + halo * 0.22;
          float fx = smoothstep(0.90, 0.0, abs(uv.x)) * smoothstep(0.26, 0.0, abs(uv.y));
          float fy = smoothstep(0.90, 0.0, abs(uv.y)) * smoothstep(0.26, 0.0, abs(uv.x));
          a += (fx + fy) * 0.28 * vFlare;
          float tw = 0.78 + 0.22 * sin(uTime * 1.6 + vSeed * 51.0);
          gl_FragColor = vec4(vColor * tw, a);
        }
      `,
    })
  );
  bgStars.renderOrder = -5;
  scene.add(bgStars);

  /* ---------------- 邻近星系：M31 / 大小麦哲伦 / M33 ----------------
     每个都是粒子云：既绕自身轴自转，又沿着一条很慢的轨道漂移。   */

  const companionVert = /* glsl */ `
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aSeed;
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uScale;
    varying vec3 vColor;
    varying float vSeed;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float dist = max(-mv.z, 1.0);
      gl_PointSize = clamp(aSize * uScale * uPixelRatio * (300.0 / dist), 0.7, 22.0 * uPixelRatio);
      vColor = aColor;
      vSeed = aSeed;
    }
  `;

  const companionFrag = /* glsl */ `
    varying vec3 vColor;
    varying float vSeed;
    uniform float uTime;
    uniform float uBright;
    void main(){
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float d = dot(uv, uv);
      if (d > 1.0) discard;
      float core = pow(1.0 - d, 1.9);
      float tw = 0.82 + 0.18 * sin(uTime * 1.1 + vSeed * 37.0);
      gl_FragColor = vec4(vColor * tw * uBright, core * 0.9);
    }
  `;

  // 通用构建：give(i) 返回 { x,y,z, r,g,b, size }
  function buildCompanion(count, give, scale, bright = 1) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const siz = new Float32Array(count);
    const sed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = give(i);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r;
      col[i * 3 + 1] = p.g;
      col[i * 3 + 2] = p.b;
      siz[i] = p.size;
      sed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sed, 1));
    const pts = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniforms.uTime,
          uPixelRatio: uniforms.uPixelRatio,
          uScale: { value: scale },
          uBright: { value: bright * 0.95 },
        },
        vertexShader: companionVert,
        fragmentShader: companionFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    pts.renderOrder = -4;
    return pts;
  }

  const companions = [];

  function addCompanion(mesh, cfg) {
    const pivot = new THREE.Group();
    pivot.add(mesh);
    const [px, py, pz] = cfg.pos;
    pivot.position.set(px, py, pz);
    mesh.rotation.set(cfg.tiltX, 0, cfg.tiltZ);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    scene.add(pivot);
    companions.push({
      pivot,
      mesh,
      spin: cfg.spin,
      orbitR: Math.hypot(px, pz),
      orbitSpeed: cfg.orbitSpeed,
      phase: Math.atan2(pz, px),
      y: py,
      bob: cfg.bob || 0,
      label: cfg.label || '',
      sub: cfg.sub || '',
      labelOffset: cfg.labelOffset || 0,
      uBright: mesh.material && mesh.material.uniforms ? mesh.material.uniforms.uBright : null,
      bright0: mesh.material && mesh.material.uniforms ? mesh.material.uniforms.uBright.value : 1,
    });
  }

  /* ---------------- 深空邻居：星系与星云（近 / 中 / 远三层） ---------------- */
  const deepField = createDeepField({ rScale: 1.15, opacityScale: 0.16 });
  // 统一偏冷的低饱和色，禁止大面积红/蓝光斑
  deepField.setTint(new THREE.Color(0.62, 0.72, 0.92));
  scene.add(deepField.group);

  /* ---------------- 流沙星河：铺满整个天空的两层尘埃 ----------------
     不挂在 galaxyGroup 上 —— 它是「整个宇宙的背景」，任何视角、任何距离都看得到，
     也不参与进场动画（银河本体和邻居才做从中心长出来的过渡）。         */
  const dustUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uAxis: { value: new THREE.Vector3(0.18, 1.0, 0.24).normalize() },
    uGain: { value: 1 },
  };
  const DUST_VERT = /* glsl */ `
    attribute vec3 aColor;
    attribute vec3 aAttr;   // (size, speed, phase)
    uniform float uTime;
    uniform float uPixelRatio;
    uniform vec3 uAxis;
    uniform float uGain;
    varying vec3 vColor;
    varying float vTw;
    vec3 rotAxis(vec3 p, vec3 ax, float a) {
      float c = cos(a), s = sin(a);
      return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c);
    }
    void main() {
      // 内圈转得快、外圈慢，整个尘埃层像被慢慢搅动的沙
      float ang = uTime * aAttr.y + aAttr.z;
      vec3 p = rotAxis(position, uAxis, ang);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aAttr.x * uPixelRatio, 1.0, 3.4 * uPixelRatio);
      vColor = aColor * uGain;
      vTw = 0.62 + 0.38 * sin(uTime * (0.35 + fract(aAttr.z) * 1.2) + aAttr.z * 3.1);
    }
  `;
  const DUST_FRAG = /* glsl */ `
    varying vec3 vColor;
    varying float vTw;
    void main() {
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float d = dot(uv, uv);
      if (d > 1.0) discard;
      gl_FragColor = vec4(vColor, pow(1.0 - d, 2.0) * vTw);
    }
  `;
  const bandRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.42, 0.9, -0.18));
  function buildDust({ count, rMin, rMax, spread, speedMin, speedMax, sizeMin, sizeMax, bright, bandRatio }) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const attr = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.pow(Math.random(), 0.55) * (rMax - rMin);
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      if (Math.random() < bandRatio) {
        // 一部分贴着一条倾斜的大圆铺开 —— 流沙的「带状」质感
        const y = (Math.random() - 0.5) * 0.34;
        const sq = Math.sqrt(Math.max(0, 1 - y * y));
        v.set(Math.cos(th) * sq, y, Math.sin(th) * sq).normalize();
        v.applyMatrix4(bandRot);
      } else {
        const sq = Math.sqrt(1 - u * u);
        v.set(Math.cos(th) * sq, u, Math.sin(th) * sq).normalize();
      }
      pos[i * 3] = v.x * r * spread;
      pos[i * 3 + 1] = v.y * r;
      pos[i * 3 + 2] = v.z * r * spread;
      const b = bright * (0.30 + Math.pow(Math.random(), 2.4) * 1.0);
      const warm = Math.random() < 0.16;
      col[i * 3] = b * (warm ? 1.0 : 0.74);
      col[i * 3 + 1] = b * (warm ? 0.79 : 0.85);
      col[i * 3 + 2] = b * (warm ? 0.55 : 1.0);
      attr[i * 3] = sizeMin + Math.pow(Math.random(), 2.2) * (sizeMax - sizeMin);
      const slow = 1 / Math.sqrt(Math.max(1, r / rMin));
      attr[i * 3 + 1] = (speedMin + Math.random() * (speedMax - speedMin)) * slow;
      attr[i * 3 + 2] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aAttr', new THREE.BufferAttribute(attr, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }
  // 远景：整个天穹的细沙，站位最远，几乎不动
  const dustFar = buildDust({
    count: 30000, rMin: 900, rMax: 2900, spread: 1.0,
    speedMin: 0.004, speedMax: 0.012, sizeMin: 1.0, sizeMax: 2.6,
    bright: 0.36, bandRatio: 0.42,
  });
  dustFar.renderOrder = -6;
  scene.add(dustFar);
  // 近景：围着银盘的一圈沙，转得更明显，镜头动起来才有「流沙」的拖影
  const dustNear = buildDust({
    count: 16000, rMin: 190, rMax: 640, spread: 1.0,
    speedMin: 0.020, speedMax: 0.060, sizeMin: 1.1, sizeMax: 3.0,
    bright: 0.42, bandRatio: 0.34,
  });
  dustNear.renderOrder = -5;
  scene.add(dustNear);

  /* ---------------- 太阳的「落点」微光：俯冲时逐渐浮现，接住转场 ---------------- */
  const sunSparkTex = new THREE.CanvasTexture(
    makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,214,150,0.75)', 128)
  );
  sunSparkTex.colorSpace = THREE.SRGBColorSpace;
  const sunSpark = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunSparkTex,
      color: 0xffe6b8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    })
  );
  sunSpark.scale.set(14, 14, 1);
  scene.add(sunSpark);

  /* ---------------- 俯冲掠过的恒星：沿飞行走廊撒一条「星星隧道」 ----------------
     起点用一堆小暗星，越接近太阳系越大越亮 —— 观感上就是「周围划过的
     先是远处星系，快到时变成太阳附近的邻居」。                            */
  const DIVE_STAR_MAX = 620;
  const diveStarPos = new Float32Array(DIVE_STAR_MAX * 3);
  const diveStarCol = new Float32Array(DIVE_STAR_MAX * 3);
  const diveStarSize = new Float32Array(DIVE_STAR_MAX);
  const diveStarGeo = new THREE.BufferGeometry();
  diveStarGeo.setAttribute('position', new THREE.BufferAttribute(diveStarPos, 3));
  diveStarGeo.setAttribute('aColor', new THREE.BufferAttribute(diveStarCol, 3));
  diveStarGeo.setAttribute('aSize', new THREE.BufferAttribute(diveStarSize, 1));
  const diveStarUniforms = { uOpacity: { value: 0 }, uPixelRatio: { value: pixelRatio } };
  const diveStars = new THREE.Points(
    diveStarGeo,
    new THREE.ShaderMaterial({
      uniforms: diveStarUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 1.0);
          gl_PointSize = clamp(aSize * uPixelRatio * (900.0 / d), 1.0, 7.0 * uPixelRatio);
          vColor = aColor;
          // 太近的星星直接淡出，免得糊住整个屏幕
          vA = smoothstep(7.0, 30.0, d);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor; varying float vA;
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor, pow(1.0 - d, 1.6) * vA * uOpacity);
        }
      `,
    })
  );
  diveStars.frustumCulled = false;
  diveStars.visible = false;
  diveStars.renderOrder = -2;
  scene.add(diveStars);

  /* ---- 径向星芒拖尾：真正穿过星际时才拉出的短划线 ---- */
  const STREAK_MAX = 520;
  const streakPos = new Float32Array(STREAK_MAX * 6);
  const streakCol = new Float32Array(STREAK_MAX * 6);
  const streakBase = new Float32Array(STREAK_MAX * 3);
  const streakSeed = new Float32Array(STREAK_MAX);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
  const streakMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  streaks.visible = false;
  streaks.renderOrder = -2;
  scene.add(streaks);
  for (let i = 0; i < STREAK_MAX; i++) {
    streakSeed[i] = 0.35 + Math.pow(Math.random(), 1.8) * 1.65;
  }

  const tmpDir = new THREE.Vector3();
  function spawnDiveStars(from, aim) {
    const seg = aim.clone().sub(from);
    for (let i = 0; i < DIVE_STAR_MAX; i++) {
      const f = Math.pow(Math.random(), 0.85);
      const px = from.x + seg.x * f;
      const py = from.y + seg.y * f;
      const pz = from.z + seg.z * f;
      // 横向散布：近端散得开，末端收拢成「太阳附近的一簇」
      const spread = (55 - 34 * f) * (0.25 + Math.pow(Math.random(), 0.7));
      tmpDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      diveStarPos[i * 3] = px + tmpDir.x * spread;
      diveStarPos[i * 3 + 1] = py + tmpDir.y * spread;
      diveStarPos[i * 3 + 2] = pz + tmpDir.z * spread;
      const big = Math.pow(f, 2.4);
      diveStarSize[i] = 0.8 + big * 2.8 + Math.random() * 1.0;
      const warm = Math.random() < 0.24;
      const b = 0.32 + big * 0.62;
      diveStarCol[i * 3] = b * (warm ? 1.0 : 0.80);
      diveStarCol[i * 3 + 1] = b * (warm ? 0.80 : 0.89);
      diveStarCol[i * 3 + 2] = b * (warm ? 0.58 : 1.0);
    }
    diveStarGeo.attributes.position.needsUpdate = true;
    diveStarGeo.attributes.aColor.needsUpdate = true;
    diveStarGeo.attributes.aSize.needsUpdate = true;
  }

  // ---- 仙女座 M31：大而斜的盘 + 明亮核球 + 两个卫星（M32 / M110）----
  {
    const R = 1.0;
    const m31 = buildCompanion(
      9000,
      () => {
        const bulge = Math.random() < 0.14;
        let x;
        let y;
        let z;
        let rr;
        if (bulge) {
          rr = Math.abs(gauss()) * 0.15 + 0.03;
          const u = Math.random() * 2 - 1;
          const ph = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          x = rr * s * Math.cos(ph);
          z = rr * s * Math.sin(ph);
          y = rr * u * 0.75;
        } else {
          const q = Math.pow(Math.random(), 0.62);
          rr = 0.18 + q * R;
          const th = Math.log(rr / 0.18) * 2.35 + (Math.random() < 0.5 ? 0 : Math.PI);
          const sc = 0.045 + rr * 0.085;
          x = Math.cos(th) * rr + gauss() * sc;
          z = Math.sin(th) * rr + gauss() * sc;
          y = gauss() * (0.10 - rr * 0.055);
        }
        const k = bulge ? 0.86 : 0.55 + 0.45 * Math.random();
        const warm = bulge || Math.random() < 0.3;
        return {
          x: x * 96,
          y: y * 96,
          z: z * 96,
          r: (warm ? 1.0 : 0.74) * k,
          g: (warm ? 0.88 : 0.83) * k,
          b: (warm ? 0.70 : 1.0) * k,
          size: bulge ? 2.8 + Math.random() * 1.6 : 2.0 + Math.random() * 1.6,
        };
      },
      2.4,
      0.30
    );
    addCompanion(m31, {
      pos: [-360, 300, -760],
      label: '仙女座星系',
      sub: 'M31 · 254 万光年',
      labelOffset: 0.0,
      spin: 0.012,
      orbitSpeed: 0.0042,
      tiltX: -0.72,
      tiltZ: 0.38,
      bob: 12,
    });

    // M32 / M110 两颗小卫星
    const sat = buildCompanion(
      260,
      () => {
        const rr = Math.abs(gauss()) * 0.5 + 0.1;
        const u = Math.random() * 2 - 1;
        const ph = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        return {
          x: rr * s * Math.cos(ph) * 40,
          y: rr * u * 34,
          z: rr * s * Math.sin(ph) * 40,
          r: 1.0,
          g: 0.9,
          b: 0.76,
          size: 2.4 + Math.random() * 1.4,
        };
      },
      2.0,
      0.34
    );
    sat.position.set(0.9, 0.55, 0.35);
    m31.add(sat);
  }

  // ---- 大麦哲伦云 LMC：不规则的棒 + 一条旋臂 + 塔兰图拉那种粉色星暴 ----
  {
    const lmc = buildCompanion(
      4200,
      () => {
        const bar = Math.random() < 0.42;
        let x;
        let y;
        let z;
        if (bar) {
          x = gauss() * 0.82;
          y = gauss() * 0.34;
          z = gauss() * 0.72;
        } else {
          const arm = Math.random() < 0.55;
          const a = Math.random() * Math.PI * 2;
          const rr = 0.35 + Math.pow(Math.random(), 0.7) * 0.9;
          const th = arm ? Math.log(rr / 0.3) * 2.6 : a;
          x = Math.cos(th) * rr + gauss() * 0.34;
          z = Math.sin(th) * rr + gauss() * 0.34;
          y = gauss() * 0.24;
        }
        const pink = Math.random() < 0.05;
        const k = 0.55 + 0.45 * Math.random();
        return {
          x: x * 46,
          y: y * 46,
          z: z * 46,
          r: pink ? 1.0 : 0.86 * k,
          g: pink ? 0.50 : 0.90 * k,
          b: pink ? 0.56 : 1.0 * k,
          size: 2.0 + Math.random() * 1.6,
        };
      },
      2.2,
      0.34
    );
    addCompanion(lmc, {
      pos: [-400, -260, -640],
      label: '大麦哲伦云',
      sub: 'LMC · 16 万光年',
      spin: 0.02,
      orbitSpeed: 0.0062,
      tiltX: -0.95,
      tiltZ: 0.30,
      bob: 9,
    });
  }

  // ---- 小麦哲伦云 SMC：更小更散，蓝白为主 ----
  {
    const smc = buildCompanion(
      1900,
      () => {
        const clump = Math.random() < 0.5;
        const spread = clump ? 0.55 : 1.0;
        return {
          x: gauss() * 30 * spread,
          y: gauss() * 20 * spread,
          z: gauss() * 12 * spread,
          r: 0.80,
          g: 0.88,
          b: 1.0,
          size: 1.8 + Math.random() * 1.3,
        };
      },
      2.0,
      0.34
    );
    addCompanion(smc, {
      pos: [520, -300, -700],
      label: '小麦哲伦云',
      sub: 'SMC · 20 万光年',
      spin: 0.03,
      orbitSpeed: 0.0052,
      tiltX: 0.35,
      tiltZ: 0.2,
      bob: 7,
    });
  }

  // ---- 三角座星系 M33：松散的小旋涡，补一点空间层次 ----
  {
    const m33 = buildCompanion(
      2600,
      () => {
        const rr = 0.12 + Math.pow(Math.random(), 0.62) * 0.82;
        const th = Math.log(rr / 0.12) * 2.0 + (Math.random() < 0.5 ? 0 : Math.PI) + gauss() * 0.32;
        const sc = 0.055 + rr * 0.16;
        return {
          x: (Math.cos(th) * rr + gauss() * sc) * 34,
          y: gauss() * 2.4,
          z: (Math.sin(th) * rr + gauss() * sc) * 34,
          r: 0.78,
          g: 0.86,
          b: 1.0,
          size: 1.9 + Math.random() * 1.4,
        };
      },
      2.2,
      0.34
    );
    addCompanion(m33, {
      pos: [330, 210, -760],
      label: '三角座星系',
      sub: 'M33 · 273 万光年',
      spin: 0.018,
      orbitSpeed: 0.0034,
      tiltX: -1.10,
      tiltZ: 0.0,
      bob: 14,
    });
  }

  /* ---------------- 状态 ---------------- */
  let t = 0;
  let lastE = 0;
  const camPos = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const sunAnchorLocal = new THREE.Vector3();
  const sunAnchorWorld = new THREE.Vector3();
  const diveFrom = new THREE.Vector3();
  const diveAim = new THREE.Vector3();
  let divePrev = 0;
  const easeIO = (x) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
  };

  // 邻近星系的名字锚点（供 main.js 投影成 HTML 标签）
  const anchors = companions.map((c) => ({
    text: c.label,
    sub: c.sub,
    pos: new THREE.Vector3(),
    visible: false,
  }));

  const state = {
    name: 'galaxy',
    scene,
    camera,
    anchors,
    // 越靠近，泛光收得越狠（否则银心会把整帧刷白）
    bloomScale() {
      return 1 - 0.42 * lastE;
    },
    update(dt, st) {
      t += dt;
      uniforms.uTime.value = t;
      nebulaUniforms.uTime.value = t;
      dustUniforms.uTime.value = t;
      deepField.update(dt, 1.0 - 0.85 * (st.nebFade || 0), uniforms.uIntro.value);
      // 背景尘埃不参与进场动画：亮度恒定，只有俯冲时稍微提一点速度感
      dustUniforms.uGain.value = (1.0 + 0.55 * (st.galaxyDive || 0)) * (1.0 - 0.35 * (st.nebFade || 0));
      nebula.rotation.y = t * 0.004;

      galaxyGroup.rotation.y = t * 0.008;
      // 背景尘埃带的朝向跟随银盘，两者才会互相协调
      nebulaUniforms.uPlane.value.set(0, 1, 0).applyEuler(galaxyGroup.rotation);
      coreGlow.material.opacity = 0.10 + Math.sin(t * 1.4) * 0.03;

      // 邻近星系：自转 + 沿轨道缓慢漂移
      for (const c of companions) {
        c.mesh.rotation.y += dt * c.spin;
        const a = c.phase + t * c.orbitSpeed;
        c.pivot.position.set(
          Math.cos(a) * c.orbitR,
          c.y + Math.sin(t * 0.08 + c.phase) * c.bob,
          Math.sin(a) * c.orbitR
        );
      }
      for (let i = 0; i < anchors.length; i++) {
        anchors[i].pos.copy(companions[i].pivot.position);
      }

      const e = Math.pow(st.dolly, 1.35);
      lastE = e;
      const intro = st.intro == null ? 1 : st.intro;
      const dist = THREE.MathUtils.lerp(250, 62, e);
      const yaw = st.yaw;
      const pitch = st.pitch;
      camPos.set(
        Math.sin(yaw) * Math.cos(pitch) * dist,
        Math.sin(pitch) * dist + 8,
        Math.cos(yaw) * Math.cos(pitch) * dist
      );

      // 进场：银河从中心一个点里「跃出」——整盘从极小撑开，而不是靠相机后退
      const grow = 0.06 + 0.94 * intro;
      galaxyGroup.scale.setScalar(grow);
      coreGlow2.material.opacity = 0.075 * (1.0 - 0.6 * e) * Math.min(1, intro * 1.6);
      // 邻近星系随进场一起「长出来」（背景流沙不参与，从头就在）
      const compFade = THREE.MathUtils.smoothstep(intro, 0.82, 0.995);
      for (const c of companions) {
        c.pivot.visible = compFade > 0.002;
        if (c.uBright) c.uBright.value = c.bright0 * compFade;
        c.pivot.scale.setScalar(0.62 + 0.38 * compFade);
      }

      // 银河 → 太阳系：镜头朝着「太阳所在的那条臂」冲过去
      const diveK = st.galaxyDive || 0;
      let fov = THREE.MathUtils.lerp(55, 72, e);
      if (diveK > 0.0005) {
        const sunR = 52;
        const sunTheta = Math.log(sunR / 7) * 2.2;
        sunAnchorLocal.set(Math.cos(sunTheta) * sunR, 0, Math.sin(sunTheta) * sunR);
        sunAnchorWorld.copy(sunAnchorLocal).applyEuler(galaxyGroup.rotation).multiplyScalar(grow);
        if (divePrev <= 0.0005) {
          diveFrom.copy(camPos);
          // 收尾机位：停在太阳锚点外侧、沿半径朝外，镜头回望整片银盘
          diveAim.copy(sunAnchorWorld).multiplyScalar(1.14);
          spawnDiveStars(diveFrom, diveAim);
        }
        const k = easeIO(diveK);
        camPos.lerpVectors(diveFrom, diveAim, k);
        lookTarget.copy(sunAnchorWorld).multiplyScalar(Math.min(1, diveK * 2.2));
        fov = THREE.MathUtils.lerp(fov, 34, k);
      } else {
        lookTarget.set(0, 0, 0);
      }
      divePrev = diveK;
      if (diveK > 0.0005) {
        diveStars.visible = true;
        diveStarUniforms.uOpacity.value =
          0.62 * THREE.MathUtils.smoothstep(diveK, 0.015, 0.10) * (1 - THREE.MathUtils.smoothstep(diveK, 0.90, 1.0));
      } else if (diveStars.visible) {
        diveStars.visible = false;
        diveStarUniforms.uOpacity.value = 0;
      }

      /* 星芒拖尾：速度越快拉得越长，切镜前后各自收掉 */
      if (diveK > 0.0005) {
        const sp = THREE.MathUtils.clamp(((diveK - divePrev) / Math.max(dt, 1e-3)) * 4.2, 0, 1);
        const env = THREE.MathUtils.smoothstep(diveK, 0.02, 0.12) *
                    (1 - THREE.MathUtils.smoothstep(diveK, 0.86, 0.995));
        for (let i = 0; i < STREAK_MAX; i++) {
          const j = i * 3;
          const bx = diveStarPos[j], by = diveStarPos[j + 1], bz = diveStarPos[j + 2];
          streakBase[j] = bx; streakBase[j + 1] = by; streakBase[j + 2] = bz;
          let dx = bx - camPos.x, dy = by - camPos.y, dz = bz - camPos.z;
          const d = Math.max(Math.hypot(dx, dy, dz), 1e-3);
          dx /= d; dy /= d; dz /= d;
          const len = (1.5 + 26 * sp) * streakSeed[i] * env;
          const k6 = i * 6;
          streakPos[k6] = bx - dx * len;
          streakPos[k6 + 1] = by - dy * len;
          streakPos[k6 + 2] = bz - dz * len;
          streakPos[k6 + 3] = bx + dx * len * 0.35;
          streakPos[k6 + 4] = by + dy * len * 0.35;
          streakPos[k6 + 5] = bz + dz * len * 0.35;
          const c = 0.55 + 0.45 * Math.min(1, sp * 1.6);
          streakCol[k6] = c; streakCol[k6 + 1] = c * 0.96; streakCol[k6 + 2] = c;
          streakCol[k6 + 3] = c * 0.35; streakCol[k6 + 4] = c * 0.38; streakCol[k6 + 5] = c * 0.45;
        }
        streakGeo.attributes.position.needsUpdate = true;
        streakGeo.attributes.color.needsUpdate = true;
        streakMat.opacity = 0.50 * env * (0.25 + 0.75 * sp);
        streaks.visible = streakMat.opacity > 0.004;
      } else if (streaks.visible) {
        streaks.visible = false;
        streakMat.opacity = 0;
      }

      // 太阳落点：俯冲越深越亮，用来把「银河里的一个点」长成太阳系的太阳
      {
        const sR = 52;
        const sTheta = Math.log(sR / 7) * 2.2;
        sunAnchorLocal.set(Math.cos(sTheta) * sR, 0, Math.sin(sTheta) * sR);
        sunAnchorWorld.copy(sunAnchorLocal).applyEuler(galaxyGroup.rotation).multiplyScalar(grow);
        sunSpark.position.copy(sunAnchorWorld);
        const dSpark = Math.max(camPos.distanceTo(sunAnchorWorld), 0.001);
        const rise = THREE.MathUtils.smoothstep(diveK, 0.10, 0.55);
        // 一直亮到切镜那一瞬 —— 它就是「要变成太阳的那个点」
        // 一直亮到切镜 —— 它就是那颗要变成太阳的星，绝不能提前灭
        sunSpark.material.opacity = rise * uniforms.uIntro.value;
        // 角径固定在 ~10°，像一颗越飞越近但形状不变的「目标星」
        const sc = THREE.MathUtils.clamp(dSpark * 0.20, 0.8, 60);
        sunSpark.scale.set(sc, sc, 1);
      }

      camera.position.copy(camPos);
      camera.lookAt(lookTarget);
      camera.fov = fov;
      camera.updateProjectionMatrix();

      // 靠近时略微抬升曝光感
      pointsMat.uniforms.uSize.value = 1.0 + e * 0.9;
      const nebFade = st.nebFade == null ? 0 : st.nebFade;
      nebulaUniforms.uOpacity.value = (1.0 - e * 0.25) * (1.0 - 0.88 * nebFade);
      // 但粒子/辉光会叠成一片白，靠近时按比例收一收
      // 俯冲穿盘时粒子会叠成一片白墙，按 dive 再收一档
      // 末尾把银盘整体压黑，只留那颗「目标星」，切镜就藏在光里
      const endFade = 1 - THREE.MathUtils.smoothstep(diveK, 0.86, 0.996);
      uniforms.uDim.value = (1.0 - 0.46 * e) * (1 - 0.45 * diveK) * (0.18 + 0.82 * endFade);
      // 进场时星系从中心一点长大的过程里，粒子要一起变小变暗（否则糊成白球）
      const iv = st.intro == null ? 1 : Math.min(1, Math.max(0, st.intro));
      uniforms.uIntro.value = iv * iv * (3 - 2 * iv);
      // 俯冲到核心附近时，这两张明尺寸的辉光会把整屏刷白 —— 按 dive 大幅收掉
      const glowKill = 1 - 0.92 * diveK;
      coreGlow.material.opacity *= (1.0 - 0.55 * e) * uniforms.uIntro.value * glowKill;
      coreGlow2.material.opacity = 0.075 * (1.0 - 0.6 * e) * uniforms.uIntro.value * glowKill;
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
  return state;
}
