import * as THREE from 'three';
import { GLSL_NOISE, makeGlowTexture } from '../util.js';
import { createEarthSurface, createCloudShell, createAtmoShell } from '../earthmat.js';
import { createPlanetMaterial } from '../planetmat.js';
import { createDeepField } from './deepfield.js';

// 真实相对半径（以地球 = 1）：水星 0.383、金星 0.949、地球 1、火星 0.532、
// 木星 11.21、土星 9.45、天王星 4.01、海王星 3.88。
// PLANET_SCALE 把它们整体缩到画面上合适的尺寸 —— 比例是真的，不是各自拍脑袋放大的。
const PLANET_SCALE = 0.13;
const ORBIT_SCALE = 0.80;
const rEarth = (ratio) => ratio * PLANET_SCALE;

const PLANETS = [
  { name: 'mercury', tex: 'mercury', inc: 28.00 * Math.PI / 180, size: rEarth(0.383), orbit: 8.2 * ORBIT_SCALE, period: 0.241, spin: 0.15, color: 0x9a8f86,
    atmo: 0x9a8f86, rim: 0.0, spec: 0.02, relief: 0.9, contrast: 0.10 },
  { name: 'venus', tex: 'venus', inc: 13.56 * Math.PI / 180, size: rEarth(0.949), orbit: 11.0 * ORBIT_SCALE, period: 0.615, spin: 0.08, color: 0xd9b98a,
    atmo: 0xffd9a0, rim: 0.12, spec: 0.0, relief: 0.18, contrast: 0.06 },
  { name: 'earth', tex: 'earth', inc: 0.00 * Math.PI / 180, size: rEarth(1.0), orbit: 14.2 * ORBIT_SCALE, period: 1.0, spin: 0.9, color: 0x4f8fd0 },
  { name: 'mars', tex: 'mars', inc: 7.40 * Math.PI / 180, size: rEarth(0.532), orbit: 17.6 * ORBIT_SCALE, period: 1.881, spin: 0.85, color: 0xb5502e,
    atmo: 0xd08a5a, rim: 0.07, spec: 0.03, relief: 0.6, contrast: 0.14 },
  { name: 'jupiter', tex: 'jupiter', inc: 5.20 * Math.PI / 180, size: rEarth(11.21), orbit: 25.5 * ORBIT_SCALE, period: 11.86, spin: 2.0, color: 0xc8a887,
    atmo: 0xffe2b8, rim: 0.15, spec: 0.0, relief: 0.06, contrast: 0.12 },
  { name: 'saturn', tex: 'saturn', inc: 9.96 * Math.PI / 180, size: rEarth(9.45), orbit: 33.0 * ORBIT_SCALE, period: 29.46, spin: 1.8, color: 0xd6c08a, ring: true,
    atmo: 0xffe8c6, rim: 0.15, spec: 0.0, relief: 0.04, contrast: 0.10 },
  { name: 'uranus', tex: 'uranus', inc: 3.08 * Math.PI / 180, size: rEarth(4.01), orbit: 39.5 * ORBIT_SCALE, period: 84.0, spin: 1.4, color: 0x8fd3de,
    atmo: 0x9fe6ff, rim: 0.24, spec: 0.02, relief: 0.02, contrast: 0.05 },
  { name: 'neptune', tex: 'neptune', inc: 7.08 * Math.PI / 180, size: rEarth(3.88), orbit: 45.5 * ORBIT_SCALE, period: 164.8, spin: 1.3, color: 0x4a6fd0,
    atmo: 0x6fa8ff, rim: 0.24, spec: 0.02, relief: 0.02, contrast: 0.08 },
];



/* ---------------- 卫星表面：程序生成的岩石 / 冰壳贴图 ---------------- */
function makeMoonTexture(style, tint) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.fillRect(0, 0, S, S);

  if (style === 'icy') {
    // 冰壳：冷白底 + 交错的冰裂隙
    for (let i = 0; i < 42; i++) {
      let x = Math.random() * S;
      let y = Math.random() * S;
      let a = Math.random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      const seg = 3 + ((Math.random() * 4) | 0);
      for (let k = 0; k < seg; k++) {
        a += (Math.random() - 0.5) * 1.1;
        x += Math.cos(a) * (8 + Math.random() * 22);
        y += Math.sin(a) * (8 + Math.random() * 22);
        g.lineTo(x, y);
      }
      g.strokeStyle = Math.random() < 0.55 ? 'rgba(150,186,214,0.55)' : 'rgba(228,240,250,0.65)';
      g.lineWidth = 0.6 + Math.random() * 1.4;
      g.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 1 + Math.random() * 7;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(196,220,238,0.5)');
      grd.addColorStop(1, 'rgba(196,220,238,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  } else {
    // 岩石：密集撞击坑（暗坑 + 亮环）
    for (let i = 0; i < 240; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const r = 1.2 + Math.pow(Math.random(), 2.4) * 16;
      const grd = g.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,0.30)');
      grd.addColorStop(0.68, 'rgba(0,0,0,0.13)');
      grd.addColorStop(0.86, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 把球面顶点做低频扰动 —— 卫星是「不规则岩石体」，不是完美正圆
function irregularSphere(radius, detail) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(8, detail * 0.7 | 0));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const f = 1
      + 0.055 * Math.sin(n.x * 5.1 + 1.7) * Math.sin(n.y * 4.3 + 0.4)
      + 0.038 * Math.sin(n.z * 7.3 + 2.1) * Math.cos(n.y * 6.1);
    v.copy(n).multiplyScalar(radius * f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* ---------------- 天然卫星：比例与轨道参考真实数据（压缩后） ---------------- */
// d = 轨道半径 / 行星半径，period 单位「天」，r = 卫星半径 / 行星半径
const MOON_TABLE = {
  earth: [{ r: 0.273, d: 3.4, period: 27.32, color: 0xbfbcb4 }],
  mars: [
    { r: 0.0031, d: 2.0, period: 0.319, color: 0x8d7f72, min: 0.016 },
    { r: 0.0017, d: 3.1, period: 1.263, color: 0x7f7469, min: 0.013 },
  ],
  jupiter: [
    { r: 0.026, d: 2.1, period: 1.769, color: 0xe8d9a8 },
    { r: 0.0224, d: 2.7, period: 3.551, color: 0xd8cfbf, ice: true },
    { r: 0.0375, d: 3.4, period: 7.155, color: 0xb8b0a4 },
    { r: 0.0343, d: 4.2, period: 16.69, color: 0x8c8074 },
  ],
  saturn: [
    { r: 0.044, d: 4.4, period: 15.95, color: 0xd9a86a },
    { r: 0.012, d: 3.3, period: 4.52, color: 0xd6e2ea, ice: true },
    { r: 0.0088, d: 2.9, period: 1.37, color: 0xe8ecef, ice: true },
  ],
  uranus: [
    { r: 0.062, d: 3.1, period: 8.71, color: 0xbfc6c9, min: 0.016 },
    { r: 0.060, d: 3.9, period: 13.46, color: 0x9aa3a8, min: 0.015 },
  ],
  neptune: [{ r: 0.055, d: 3.3, period: 5.877, color: 0xd8cfc6, min: 0.016 }],
};

export function createSolar(pixelRatio, tex) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 6000);

  /* ---------------- 太阳 ---------------- */
  const sunUniforms = { uTime: { value: 0 }, uSpin: { value: 0 }, uDim: { value: 1 } };
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: sunUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vPos; varying vec3 vNormal;
        void main(){
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vPos; varying vec3 vNormal;
        uniform float uTime;
        uniform float uSpin;
        uniform float uDim;
        ${GLSL_NOISE}
        void main(){
          vec3 p = normalize(vPos);
          // 太阳自转：在着色器里旋转采样方向，表面纹理才会真的转起来
          float cs = cos(uSpin), sn = sin(uSpin);
          p.xz = mat2(cs, -sn, sn, cs) * p.xz;
          float n1 = fbm3(p * 3.1 + vec3(0.0, uTime * 0.045, uTime * 0.012));
          float n2 = fbm3(p * 8.7 - vec3(uTime * 0.075, 0.0, uTime * 0.03));
          float n3 = fbm3(p * 18.0 + vec3(uTime * 0.09));
          float g = smoothstep(0.28, 0.82, n1 * 0.8 + n2 * 0.42 + n3 * 0.12);

          vec3 c0 = vec3(0.98, 0.22, 0.02);
          vec3 c1 = vec3(1.0, 0.55, 0.08);
          vec3 c2 = vec3(1.0, 0.94, 0.68);
          vec3 col = mix(c0, c1, g);
          col = mix(col, c2, smoothstep(0.74, 1.0, g) * 0.85);

          float limb = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.4);
          col += vec3(1.0, 0.52, 0.16) * limb * 0.45;
          col *= 0.86 * uDim;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  scene.add(sun);

  const glowTex = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,170,60,0.85)'));
  glowTex.colorSpace = THREE.SRGBColorSpace;

  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc885, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
    })
  );
  sunGlow.scale.set(2.13, 2.13, 1);
  scene.add(sunGlow);

  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex, color: 0xffb070, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32,
    })
  );
  sunHalo.scale.set(3.87, 3.87, 1);
  scene.add(sunHalo);

  // 行星材质全走自绘 shader，不再需要场景灯光（太阳方向由 uniform 传进去）
  scene.add(new THREE.AmbientLight(0x35507f, 0.85));

  /* ---------------- 行星 ---------------- */
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  const planets = [];
  const orbitLineMat = new THREE.LineBasicMaterial({ color: 0x2f3d52, transparent: true, opacity: 0.022, depthWrite: false });
  const ringTex = tex.ring || null;
  let earthSurface = null;
  let earthCloudShell = null;

  PLANETS.forEach((p, idx) => {
    const pivot = new THREE.Object3D();
    // 每颗行星一条自己的倾斜轨道 —— 不在同一水平面
    pivot.rotation.z = (p.inc || 0) * 0.85;
    pivot.rotation.x = (p.inc || 0);
    pivot.rotation.y = idx * 0.72;
    orbitGroup.add(pivot);

    let mesh;
    if (p.name === 'earth' && tex.earth) {
      // 地球不跟其它行星一样用标准材质：贴图、晨昏线、海面高光、夜灯、大气都走自己的 shader
      earthSurface = createEarthSurface({
        day: tex.earth,
        night: tex.earthNight,
        water: tex.earthWater,
        radius: p.size,
        segments: 96,
        sunDir: new THREE.Vector3(1, 0, 0),
        nightGain: 0.85,
      });
      mesh = earthSurface.mesh;

      earthCloudShell = createCloudShell({
        clouds: tex.earthClouds,
        radius: p.size,
        segments: 64,
        sunDir: earthSurface.uniforms.uSunDir.value,
        opacity: 0.92,
      });
      earthCloudShell.uniforms.uSunDir.value = earthSurface.uniforms.uSunDir.value;
      mesh.add(earthCloudShell.mesh);

      const atmo = createAtmoShell({
        radius: p.size,
        segments: 64,
        sunDir: earthSurface.uniforms.uSunDir.value,
        color: 0x6ab4ff,
        strength: 0.55,
      });
      atmo.uniforms.uSunDir.value = earthSurface.uniforms.uSunDir.value;
      mesh.add(atmo.mesh);
    } else {
      const pm = createPlanetMaterial({
        map: tex[p.tex] || null,
        tint: 0xffffff,
        atmo: p.atmo ?? p.color,
        rim: p.rim ?? 0.1,
        spec: p.spec ?? 0.02,
        relief: p.relief ?? 0.2,
        contrast: p.contrast ?? 0.06,
        sunDir: new THREE.Vector3(1, 0, 0),
      });
      const geoHi = new THREE.SphereGeometry(p.size, 96, 64);
      const geoLo = new THREE.SphereGeometry(p.size, 24, 16);
      mesh = new THREE.Mesh(geoLo, pm.material);
      mesh.userData.geoHi = geoHi;
      mesh.userData.geoLo = geoLo;
      mesh.userData.pmat = pm.uniforms;
    }
    mesh.position.x = p.orbit;
    mesh.rotation.z = idx === 6 ? 1.7 : 0.0;
    pivot.add(mesh);

    if (p.ring && ringTex) {
      const inner = p.size * 1.35;
      const outer = p.size * 2.35;
      const rg = new THREE.RingGeometry(inner, outer, 160, 1);
      const pos = rg.attributes.position;
      const uv = rg.attributes.uv;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const r = Math.sqrt(v.x * v.x + v.y * v.y);
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const ring = new THREE.Mesh(
        rg,
        new THREE.MeshBasicMaterial({
          map: ringTex, transparent: true, side: THREE.DoubleSide,
          opacity: 0.88, depthWrite: false, color: 0xffffff, toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      mesh.add(ring);
    }

    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      orbitLineMat
    );
    pivot.add(line);

    planets.push({
      data: p,
      mesh,
      pivot,
      angle: Math.random() * Math.PI * 2,
      speed: 0.42 * Math.pow(1 / p.period, 0.62),
      spin: 0.25 + Math.random() * 0.4,
    });
  });

  /* ---------- 冲向地球用的锚点（转场时镜头直接俯冲到这颗地球上） ---------- */
  const earthPlanet = planets.find((p) => p.data.name === 'earth');
  const earthMesh = earthPlanet.mesh;
  const earthClouds = earthCloudShell ? earthCloudShell.mesh : null;
  const EARTH_R = earthPlanet.data.size;
  const sunDirTmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const trackCenter = new THREE.Vector3();
  let lastDYaw = 0;
  let lastDPitch = 0;
  const trackTarget = new THREE.Vector3();
  const earthPos = new THREE.Vector3();
  const earthStart = new THREE.Vector3();
  const diveDir = new THREE.Vector3(0, 0.3, 1);
  const diveStart = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  let divePrev = 0;
  const smooth01 = (x) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
  };

  /* ---------------- 小行星带 ---------------- */
  const beltN = 2200;
  const beltPos = new Float32Array(beltN * 3);
  const beltCol = new Float32Array(beltN * 3);
  const beltSize = new Float32Array(beltN);
  // 三条松散的族 + 柯克伍德空隙：疏密自然，不是均匀点阵
  const CLUMPS = [
    { r: 20.05, w: 0.45, share: 0.42 },
    { r: 21.15, w: 0.55, share: 0.34 },
    { r: 22.15, w: 0.70, share: 0.24 },
  ];
  for (let i = 0; i < beltN; i++) {
    const pick = Math.random();
    let cl = CLUMPS[0];
    let acc = 0;
    for (const c of CLUMPS) { acc += c.share; if (pick <= acc) { cl = c; break; } }
    const r = cl.r + (Math.random() - 0.5) * cl.w * 2;
    const a = Math.random() * Math.PI * 2;
    beltPos[i * 3] = Math.cos(a) * r;
    beltPos[i * 3 + 1] = (Math.random() - 0.5) * 0.62;
    beltPos[i * 3 + 2] = Math.sin(a) * r;
    // 少数大块反光明显，多数是暗尘；亮度差拉开才自然
    const big = Math.pow(Math.random(), 5.0);
    const b = 0.06 + big * 0.62 + Math.random() * 0.10;
    const icy = Math.random() < 0.25;
    beltCol[i * 3] = b * (icy ? 0.86 : 1.0);
    beltCol[i * 3 + 1] = b * (icy ? 0.92 : 0.86);
    beltCol[i * 3 + 2] = b * (icy ? 1.0 : 0.72);
    beltSize[i] = 0.35 + Math.pow(Math.random(), 4.0) * 2.6;
  }
  const beltGeo = new THREE.BufferGeometry();
  beltGeo.setAttribute('position', new THREE.BufferAttribute(beltPos, 3));
  beltGeo.setAttribute('aColor', new THREE.BufferAttribute(beltCol, 3));
  beltGeo.setAttribute('aSize', new THREE.BufferAttribute(beltSize, 1));

  const beltPoints = new THREE.Points(
    beltGeo,
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uBgDim: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uPixelRatio * (120.0 / max(-mv.z, 1.0)), 0.6, 3.2 * uPixelRatio);
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor, pow(1.0 - d, 2.0) * 0.85);
        }
      `,
    })
  );
  orbitGroup.add(beltPoints);

  /* ---------------- 深空背景：星云 + 尘埃 + 远处星系（近 / 中 / 远） ---------------- */
  const deepField = createDeepField({ rScale: 2.2, wScale: 1.2, opacityScale: 0.20 });
  deepField.setTint(new THREE.Color(0.66, 0.76, 0.95));
  // 背景色温跟随当前聚焦的行星：火星暖橙、木星金棕、冰巨星冷蓝
  const PLANET_TINT = {
    mercury: 0xffd6b8, venus: 0xffdca8, earth: 0xc2dcff, mars: 0xffb488,
    jupiter: 0xffd8a6, saturn: 0xffe8c4, uranus: 0xafe0ff, neptune: 0xa6c6ff,
  };
  const deepTint = new THREE.Color(1, 1, 1);
  const deepWhite = new THREE.Color(1, 1, 1);
  const deepTarget = new THREE.Color(1, 1, 1);
  scene.add(deepField.group);

  /* ---------------- 流动星河背景 ---------------- */
  const skyUniforms = { uTime: { value: 0 }, uClean: { value: 0 }, uBgDim: { value: 1 } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2200, 48, 32),
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
        uniform float uClean;
        ${GLSL_NOISE}
        void main(){
          vec3 dir = normalize(vDir);
          // 沿一条倾斜大圆流动的星河
          float flow = uTime * 0.015;
          vec3 q = dir * 2.0;
          q.xz += vec2(flow, flow * 0.35);
          float n1 = fbm3(q * 1.15);
          float n2 = fbm3(q * 2.8 + 17.0);
          float n3 = fbm3(q * 6.5 - 9.0);

          // 银河带（大圆），带一点缓慢的起伏，看起来在流动
          float bandRaw = 1.0 - abs(dir.y * 1.7 + 0.22 * sin(dir.z * 2.6 + uTime * 0.04)
                                    + 0.12 * sin(dir.x * 1.7 - uTime * 0.03));
          float band = smoothstep(0.0, 0.75, bandRaw);
          float gwCore = smoothstep(0.55, 1.0, band) * smoothstep(0.20, 0.90, n1);

          vec3 cDeep  = vec3(0.0026, 0.0052, 0.0145);
          vec3 cBlue  = vec3(0.0150, 0.0420, 0.1150);
          vec3 cWhite = vec3(0.0950, 0.1100, 0.1650);
          vec3 cAmber = vec3(0.1200, 0.0800, 0.0450);
          vec3 cRed   = vec3(0.1000, 0.0300, 0.0400);
          vec3 cTeal  = vec3(0.0160, 0.0700, 0.0900);

          vec3 col = mix(cDeep, cBlue, smoothstep(0.34, 0.90, n1) * 0.52);
          col += cWhite * pow(band, 3.0) * (0.055 + 0.18 * smoothstep(0.52, 0.96, n2));
          col += cAmber * pow(gwCore, 2.0) * 0.16;

          // 尘埃带：把银河切出一条条暗缝
          float dust = smoothstep(0.54, 0.66, fbm3(q * 4.2 + 31.0)) * pow(band, 1.6);
          col *= 1.0 - dust * 0.30;

          // 零星发射星云（Hα 偏红 + 少量青绿）
          float neb = pow(smoothstep(0.68, 0.99, n3), 2.6) * band;
          col += cRed * neb * 0.22 + cTeal * neb * 0.10;

          // 极细的星尘
          float sp = pow(fbm3(dir * 270.0 + vec3(uTime * 0.05)), 12.0);
          col += vec3(0.62, 0.80, 1.0) * sp * 0.18;
          // 电影级收尾：背景收成纯黑深空，只留极淡星尘
          col *= 1.0 - 0.90 * uClean;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // 星河颗粒（三层视差，铺满全天 + 一条倾斜银道带，随机闪烁）
  const layers = [];
  const starSprite = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(190,220,255,0.6)', 64));
  for (let L = 0; L < 3; L++) {
    const count = [2200, 1500, 900][L];
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const radius = [420, 940, 1650][L];
    for (let i = 0; i < count; i++) {
      const rr = radius * (0.92 + Math.random() * 0.16);
      let px, py, pz;
      if (Math.random() < 0.5) {
        const ang = Math.random() * Math.PI * 2;
        px = Math.cos(ang) * rr;
        py = (Math.random() - 0.5) * radius * 0.17;
        pz = Math.sin(ang) * rr;
        const tilt = 0.42, cy = Math.cos(tilt), sy = Math.sin(tilt);
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
      const b = 0.09 + Math.pow(Math.random(), 3.6) * 0.50;
      const warm = Math.random() < 0.14;
      col[i * 3] = b * (warm ? 1.0 : 0.83 + Math.random() * 0.14);
      col[i * 3 + 1] = b * (warm ? 0.83 : 0.91 + Math.random() * 0.09);
      col[i * 3 + 2] = b * (warm ? 0.65 : 0.98 + Math.random() * 0.02);
      // 近层大而疏、远层小而密：靠尺寸/亮度差拉出纵深，而不是靠堆数量
      size[i] = (0.45 + Math.pow(Math.random(), 4.2) * 2.4) * [1.55, 1.0, 0.72][L];
      phase[i] = Math.random() * 6.2831;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uMap: { value: starSprite } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uPixelRatio; uniform float uTime;
        varying vec3 vColor; varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uPixelRatio * (900.0 / max(-mv.z, 1.0)), 0.9 * uPixelRatio, 5.4 * uPixelRatio);
          vColor = aColor;
          float sp = 0.5 + fract(aPhase * 0.159) * 1.1;
          vTw = 0.55 + 0.45 * sin(uTime * sp + aPhase);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        uniform float uBgDim;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor * uBgDim, pow(1.0 - d, 2.4) * vTw * uBgDim);
        }
      `,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = -5 + L;
    scene.add(p);
    layers.push({ points: p, mat: m, speed: [0.008, 0.013, 0.019][L] });
  }

  /* ---------------- 近邻恒星（带名字） ---------------- */
  // 真实距离只有几到十几光年，这里按「真实方位 + 象征性远近」摆在天球内侧，
  // 只负责构图与信息量；名字用世界坐标投影到 HTML 上（见 main.js 的 labels）。
  const NEIGHBORS = [
    { text: '比邻星', sub: 'PROXIMA CENTAURI · M5.5Ve · 4.24 光年', az: -28, el: 14, dist: 980, color: 0xff6a4a, size: 24, tw: 0.70 },
    { text: '南门二', sub: 'ALPHA CENTAURI A/B · G2V+K1V · 4.37 光年', az: 8, el: -20, dist: 1010, color: 0xffd9a0, size: 32, tw: 0.50 },
    { text: '巴纳德星', sub: "BARNARD'S STAR · M4V · 5.96 光年", az: 46, el: 26, dist: 955, color: 0xff8a5c, size: 19, tw: 0.92 },
    { text: '沃夫 359', sub: 'WOLF 359 · M6Ve · 7.86 光年', az: -58, el: -30, dist: 1040, color: 0xff5f4a, size: 16, tw: 1.10 },
    { text: '天狼星', sub: 'SIRIUS A/B · A1V+DA2 · 8.60 光年', az: 22, el: 34, dist: 935, color: 0xc6dcff, size: 42, tw: 0.44 },
    { text: '鲸鱼座 UV', sub: 'UV CETI A · M5.5Ve · 8.73 光年', az: -12, el: -46, dist: 1000, color: 0xff7050, size: 17, tw: 1.34 },
    { text: '罗斯 154', sub: 'ROSS 154 · M3.5Ve · 9.69 光年', az: 66, el: -6, dist: 1012, color: 0xff8a66, size: 18, tw: 0.96 },
    { text: '天苑四', sub: 'EPSILON ERIDANI · K2V · 10.5 光年', az: -44, el: 44, dist: 1055, color: 0xffc07a, size: 25, tw: 0.60 },
  ];
  const softSprite = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 96));
  // 恒星核心：实心盘 + 一圈很窄的衰减，比柔光贴图「实」得多
  const hardSprite = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.42, 'rgba(255,255,255,1)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  let nearStarLayer = null;
  const anchors = [];
  const neighbors = [];
  const deg = Math.PI / 180;
  NEIGHBORS.forEach((n, i) => {
    const az = n.az * deg;
    const el = n.el * deg;
    const pos = new THREE.Vector3(
      Math.cos(el) * Math.sin(az) * n.dist,
      Math.sin(el) * n.dist,
      -Math.cos(el) * Math.cos(az) * n.dist
    );
    const group = new THREE.Group();
    group.position.copy(pos);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softSprite, color: n.color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    core.scale.setScalar(n.size * 0.85);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softSprite, color: n.color, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    halo.scale.setScalar(n.size * 1.30);
    // 一颗锐利的小核：没有它，恒星看起来只是一团糊光
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: hardSprite, color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    dot.scale.setScalar(n.size * 0.42);
    group.add(halo, dot, core);
    group.renderOrder = -6;
    scene.add(group);
    neighbors.push({ core, halo, dot, base: 0.9, tw: n.tw, ph: i * 1.9 + 0.7, color: n.color });
    anchors.push({
      text: n.text, sub: n.sub, pos: pos.clone(), alpha: 0.9, small: true,
    });
  });


  /* ---- 建卫星：不规则岩石 / 冰壳，独立淡轨道线，跟随母行星 ---- */
  const moons = [];
  const moonOrbits = [];
  for (const p of planets) {
    const list = MOON_TABLE[p.data.name];
    if (!list) continue;
    for (const m of list) {
      const mr = Math.max(p.data.size * m.r * 1.9, p.data.size * 0.16);
      const style = m.ice ? 'icy' : 'rocky';
      const tex = makeMoonTexture(style, m.ice ? '#cfdae4' : '#8e8a83');
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uMap: { value: tex },
          uTint: { value: new THREE.Color(m.color) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW; varying vec2 vUv;
          void main(){
            vUv = uv;
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir; uniform sampler2D uMap; uniform vec3 uTint;
          varying vec3 vN; varying vec3 vW; varying vec2 vUv;
          void main(){
            vec3 N = normalize(vN);
            vec3 L = normalize(uSunDir);
            float ndl = dot(N, L);
            // 明暗交界柔和一点，背光面留一点环境光，不死黑
            float lit = clamp((ndl + 0.16) / 1.16, 0.0, 1.0);
            vec3 base = texture2D(uMap, vUv).rgb * uTint;
            vec3 col = base * (0.075 + 1.02 * lit);
            // 边缘稀薄辉光
            float rim = pow(1.0 - abs(dot(N, normalize(cameraPosition - vW))), 3.4);
            col += base * rim * 0.10 * smoothstep(-0.15, 0.7, ndl);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      const mesh = new THREE.Mesh(irregularSphere(mr, 26), mat);
      mesh.rotation.z = (Math.random() - 0.5) * 0.5;
      scene.add(mesh);

      const dist = Math.max(p.data.size * m.d, mr * 2.4);
      const incl = (m.incl || 0) + (Math.random() - 0.5) * 0.06;

      // 独立轨道线：比行星轨道更淡，倾角各不同
      const seg = 96;
      const pts = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * dist, Math.sin(a) * dist * Math.sin(incl), Math.sin(a) * dist * Math.cos(incl)));
      }
      const oGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const oMat = new THREE.LineBasicMaterial({ color: 0x3a4a60, transparent: true, opacity: 0.020, depthWrite: false });
      const orbit = new THREE.Line(oGeo, oMat);
      orbit.position.copy(p.mesh.position);
      scene.add(orbit);
      moonOrbits.push(orbit);

      moons.push({
        mesh, mat, host: p, r: mr, dist, period: m.period,
        angle: Math.random() * Math.PI * 2, incl,
        spin: (0.4 + Math.random() * 0.9) * (Math.random() < 0.5 ? 1 : -1),
      });
    }
  }
  /* ---------- 选中行星的柔和高亮光晕（层级 3/4） ---------- */
  const focusHaloTex = new THREE.CanvasTexture(
    makeGlowTexture('rgba(180,235,255,0.95)', 'rgba(120,190,255,0.55)', 128)
  );
  focusHaloTex.colorSpace = THREE.SRGBColorSpace;
  const focusHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: focusHaloTex,
      color: 0xa9d8ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,          // 球体挡住中间，只留外面一圈，才像光晕
      opacity: 0,
    })
  );
  focusHalo.visible = false;
  scene.add(focusHalo);

  // 视线中心附近、且离镜头最近的行星（滚轮对焦、张开手掌进选择页、拉近放大都用它）
  const pickTmp = new THREE.Vector3();
  function pickPlanetInView() {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    let best = -1;
    let bestScore = -1;
    planets.forEach((p, i) => {
      p.mesh.getWorldPosition(pickTmp);
      const to = pickTmp.clone().sub(camera.position);
      const d = to.length();
      if (d < 1e-3) return;
      const cos = to.normalize().dot(fwd);
      if (cos < 0.72) return;                 // 视野中心约 44° 内才算「对准」
      const score = cos * 1000 - d;           // 越居中、越近的优先
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  /* ---------------- 会随手势视差移动的闪烁星场 ---------------- */
  // 半径 150–330 的近景星：相机一转就明显滑过画面，配合不规则闪烁，给纵深感。
  const nearStarUniforms = { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uClean: { value: 0 }, uBgDim: { value: 1 } };
  {
    const COUNT = 2600;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    const twk = new Float32Array(COUNT);
    const tmp = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const rr = 260 + Math.pow(Math.random(), 0.65) * 320;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * rr;
      pos[i * 3 + 1] = u * rr * 0.82;
      pos[i * 3 + 2] = Math.sin(a) * s * rr;
      // 色温：多数偏冷白，少量暖橙，蓝白（A 型）几颗
      const r0 = Math.random();
      if (r0 < 0.62) tmp.setRGB(0.78, 0.86, 1.0);
      else if (r0 < 0.86) tmp.setRGB(1.0, 0.86, 0.70);
      else if (r0 < 0.97) tmp.setRGB(1.0, 0.70, 0.58);
      else tmp.setRGB(0.72, 0.84, 1.0);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      size[i] = 0.55 + Math.pow(Math.random(), 2.6) * 1.5;
      phase[i] = Math.random() * Math.PI * 2;
      twk[i] = 0.6 + Math.random() * 2.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aTw', new THREE.BufferAttribute(twk, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: nearStarUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase; attribute float aTw;
        uniform float uTime; uniform float uPixelRatio; uniform float uClean;
        varying vec3 vColor; varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uPixelRatio * (620.0 / max(-mv.z, 1.0)), 0.7, 2.2 * uPixelRatio);
          // 两条不同频率的正弦叠乘 → 不规则的忽明忽暗，而不是机械呼吸
          float s1 = 0.5 + 0.5 * sin(uTime * aTw + aPhase);
          float s2 = 0.5 + 0.5 * sin(uTime * aTw * 0.53 + aPhase * 2.7);
          vTw = 0.45 + 0.55 * s1 * s2;
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        uniform float uClean; uniform float uBgDim;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor * 0.72, pow(1.0 - d, 2.0) * 0.9 * vTw * (1.0 - 0.62 * uClean) * uBgDim);
        }
      `,
    });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = -4;
    scene.add(pts);
    nearStarLayer = pts;
  }

  /* ---------------- 更新 ---------------- */
  let t = 0;
  const state = {
    name: 'solar',
    scene,
    camera,
    anchors,
    // 俯冲结束时的「交接快照」：让地球场景第一帧和太阳系末帧对齐
    getHandoff() {
      const p = new THREE.Vector3();
      earthMesh.getWorldPosition(p);
      const camDir = camera.position.clone().sub(p).normalize();
      return {
        sunDir: p.clone().negate().normalize(), // 地心指向太阳
        camDir,
        yaw: earthMesh.rotation.y,
      };
    },
    // 供导航层使用：第 i 颗行星的世界坐标
    nearestInView: pickPlanetInView,
    planetPos(i, out) {
      const pl = planets[i];
      if (!pl) return out.set(0, 0, 0);
      pl.mesh.updateWorldMatrix(true, false);
      return pl.mesh.getWorldPosition(out);
    },
    planetRadius(i) {
      const pl = planets[i];
      return pl ? pl.data.size : 1;
    },
    // 地球当前在画面里占多高：直径 / 画面高度（0.33 = 三分之一屏）
    earthFrac() {
      const p = new THREE.Vector3();
      earthMesh.getWorldPosition(p);
      const d = camera.position.distanceTo(p);
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * d;
      return (EARTH_R * 2) / (halfH * 2);
    },
    probe() {
      const p = new THREE.Vector3();
      earthMesh.getWorldPosition(p);
      const L = earthSurface.uniforms.uSunDir.value;
      const camDir = camera.position.clone().sub(p).normalize();
      return {
        earthPos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)],
        sunDir: [L.x.toFixed(2), L.y.toFixed(2), L.z.toFixed(2)],
        dot: +L.dot(camDir).toFixed(3),
        dive: +(window.U ? window.U.st.dive : 0).toFixed(3),
      };
    },
    update(dt, st) {
      t += dt;
      sunUniforms.uTime.value = t;
      sunUniforms.uSpin.value += dt * 0.11;
      skyUniforms.uTime.value = t;
      const cleanK = st.clean == null ? 0 : st.clean;
      skyUniforms.uClean.value = cleanK;
      nearStarUniforms.uClean.value = cleanK;
      nearStarUniforms.uTime.value = t;
      // 近邻恒星：不规则闪烁，亮度压低，别抢行星的戏
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        const s1 = 0.5 + 0.5 * Math.sin(t * n.tw + n.ph);
        const s2 = 0.5 + 0.5 * Math.sin(t * n.tw * 0.47 + n.ph * 2.3);
        const tw = 0.62 + 0.38 * s1 * s2;
        // 进场时（arrive<1）近邻恒星随「拉近」一起浮现：越靠近越像太阳的邻居
        const nr = st.solarArrive == null ? 1 : st.solarArrive;
        const nearFade = THREE.MathUtils.smoothstep(nr, 0.62, 0.99);
        n.core.material.opacity = n.base * tw * nearFade;
        n.halo.material.opacity = 0.22 * tw * nearFade;
        if (n.dot) n.dot.material.opacity = 0.95 * nearFade;
      }
      sun.rotation.y = sunUniforms.uSpin.value;
      // 转场收尾：太阳在最后 0.5s 才「点亮」，先是一点微光再长大
      const sRev = THREE.MathUtils.clamp(st.sunReveal == null ? 1 : st.sunReveal, 0, 1);
      // 最大体积比之前小三分之一；起点几乎为零，随动画一路长大
      const sScale = (0.05 + 0.95 * sRev) * 0.66;
      sun.scale.setScalar(sScale);
      sun.visible = sRev > 0.004;

      // 俯冲时整场节奏放慢一点（电影感），别让地球跑得太快
      const slow = 1 - 0.8 * (st.dive || 0);
      const detailK = THREE.MathUtils.clamp(st.detailAmt || 0, 0, 1);
      const focusAmtNow = THREE.MathUtils.clamp(st.focusAmt || 0, 0, 1);
      const detailNow = detailK;
      // 特写阶段整体放慢到全景的 18%：看得清纹路，也不会一下滑出画面
      const tempo = 1 - 0.82 * detailK;
      planets.forEach((p, pi) => {
        p.angle += dt * p.speed * slow * tempo;
        p.mesh.position.x = Math.cos(p.angle) * p.data.orbit;
        p.mesh.position.z = Math.sin(p.angle) * p.data.orbit;
        p.ownSpin = (p.ownSpin || 0) + dt * p.spin * tempo;
        const focused = pi === st.focus && detailK > 0.5;
        // 特写时手势直接转动行星本体（相机不动），松手后回到低速自转
        p.mesh.rotation.y = p.ownSpin + (focused ? (st.detailYaw || 0) : 0);
        p.mesh.rotation.x = focused ? THREE.MathUtils.clamp(st.detailPitch || 0, -1.5, 1.5) : 0;
        // 每颗行星的「太阳方向」= 它自己指向原点（太阳在原点）
        const mu = p.mesh.userData.pmat;
        if (mu) {
          p.mesh.getWorldPosition(sunDirTmp);
          mu.uSunDir.value.copy(sunDirTmp).negate().normalize();
        }
        // LOD：只有进入对焦/特写的那颗用高面数球，其余远景一律低模
        if (p.mesh.userData.geoHi) {
          const wantHi = pi === st.focus && (focusAmtNow > 0.55 || detailNow > 0.55);
          const target = wantHi ? p.mesh.userData.geoHi : p.mesh.userData.geoLo;
          if (p.mesh.geometry !== target) p.mesh.geometry = target;
        }
      });
      // 天然卫星：绕母行星公转，位置每帧跟随，视角一变它们也跟着走
      moons.forEach((m, i) => {
        m.angle += dt * (1.9 / Math.pow(m.period, 0.55)) * slow;
        const h = m.host.mesh.position;
        const ca = Math.cos(m.angle) * m.dist;
        const sa = Math.sin(m.angle) * m.dist;
        m.mesh.position.set(
          h.x + ca,
          h.y + sa * Math.sin(m.incl),
          h.z + sa * Math.cos(m.incl)
        );
        m.mesh.rotation.y += dt * m.spin;
        m.mat.uniforms.uSunDir.value.copy(h).negate().normalize();
        if (moonOrbits[i]) moonOrbits[i].position.copy(h);
      });

      if (earthClouds) earthClouds.rotation.y += dt * 0.018;
      // 地球的太阳方向：太阳在原点，方向就是「地心 → 原点」
      if (earthSurface) {
        earthMesh.getWorldPosition(sunDirTmp);
        earthSurface.uniforms.uSunDir.value.copy(sunDirTmp).negate().normalize();
        // 转场收尾：地球在最后 0.2 秒才「亮起来」
        if (earthSurface.uniforms.uReveal) {
          earthSurface.uniforms.uReveal.value = st.earthReveal == null ? 1 : st.earthReveal;
        }
      }

      beltPoints.rotation.y += dt * 0.02;
      layers.forEach((l) => { l.mat.uniforms.uTime.value = t; l.points.rotation.y += dt * l.speed; });
      deepField.update(dt, 1.0 - 0.9 * (st.clean || 0) * (1 - 0.55*(st.focusAmt||0)), 1);
      // 聚焦时背景染上行星的环境色（缓慢过渡，避免闪色）
      const fa = st.focusAmt || 0;
      const fpl = planets[st.focus];
      const tintHex = fa > 0.001 && fpl ? PLANET_TINT[fpl.data.name] : null;
      if (tintHex) deepTarget.setHex(tintHex); else deepTarget.copy(deepWhite);
      deepTint.lerp(deepTarget, 1 - Math.exp(-dt / 0.9));
      deepField.setTint(deepTint);
      orbitGroup.rotation.y += dt * 0.006;

      // 特写里手势转的是行星本体，但整个视野也得动：其他行星沿轨道挪、星场反向平移，
      // 这样才像真的在绕着它换观测角度，而不是只有一颗球在自转
      {
        const cy = st.detailYaw || 0;
        const cp = st.detailPitch || 0;
        const dy2 = cy - lastDYaw;
        const dp2 = cp - lastDPitch;
        if (Math.abs(dy2) > 1e-6 || Math.abs(dp2) > 1e-6) {
          orbitGroup.rotation.y -= dy2 * 0.55;      // 其他行星 / 小行星带跟着扫过
          sky.rotation.y -= dy2 * 0.30;             // 银河与星云反向漂移
          sky.rotation.x = THREE.MathUtils.clamp(sky.rotation.x - dp2 * 0.22, -0.9, 0.9);
          layers.forEach((l) => { l.points.rotation.y -= dy2 * 0.34; });
          if (deepField && deepField.group) deepField.group.rotation.y -= dy2 * 0.22;
          moons.forEach((m) => { m.mesh.position.y += 0; });   // 卫星位置由母星带动，无需额外处理
          lastDYaw = cy;
          lastDPitch = cp;
        }
      }

      // 背景随层级收束：选择页略暗、特写页最干净，让行星成为唯一视觉主体
      const bgDim = 1 - 0.30 * (st.focusAmt || 0) - 0.20 * (st.detailAmt || 0);
      if (skyUniforms.uBgDim) skyUniforms.uBgDim.value = bgDim;
      if (nearStarUniforms.uBgDim) nearStarUniforms.uBgDim.value = bgDim;
      if (typeof layers !== 'undefined') {
        layers.forEach((l) => { if (l.mat.uniforms.uBgDim) l.mat.uniforms.uBgDim.value = bgDim; });
      }

      const e = Math.pow(st.dolly, 1.25);
      // 相机绕「注视中心」旋转：默认是太阳，滚轮对准某颗行星时中心跟过去，
      // 于是放大是朝那颗行星推进，而不是永远朝太阳
      const trk = st.track == null ? -1 : st.track;
      if (trk >= 0 && planets[trk]) trackTarget.copy(planets[trk].mesh.position);
      else trackTarget.set(0, 0, 0);
      trackCenter.lerp(trackTarget, 1 - Math.exp(-dt / 0.9));
      // 进场：从太阳表面附近快速拉远到全景（配合银河 → 太阳系的转场）
      const arrive = st.solarArrive == null ? 1 : st.solarArrive;
      const dist = THREE.MathUtils.lerp(44, 16, e) * arrive;
      camPos.set(
        Math.sin(st.yaw) * Math.cos(st.pitch) * dist + trackCenter.x,
        Math.sin(st.pitch) * dist + trackCenter.y,
        Math.cos(st.yaw) * Math.cos(st.pitch) * dist + trackCenter.z
      );
      let fov = THREE.MathUtils.lerp(58, 64, e);

      // 拉近到一定程度后，镜头不再只朝太阳推，而是转向地球靠过去：
      // 地球会在画面里真的长大，占满约三分之一屏时自然接管转场。
      // 必须在 dive 分支之前做，dive 才接得住这个机位，不会跳。
      const wtZoom = THREE.MathUtils.smoothstep(st.dolly, 0.52, 0.94);
      if (wtZoom > 0.001) {
        // 放大对准的是「视野中心的那颗行星」——滚轮/手势缩放到哪颗，就朝哪颗推
        const zoomIdx = pickPlanetInView();
        if (zoomIdx >= 0) {
          st.track = zoomIdx;
          planets[zoomIdx].mesh.getWorldPosition(earthPos);
          const pr = planets[zoomIdx].data.size;
          // 从「向阳侧偏 60°」靠过去：落在画外的是太阳，不会糊成一团橙光
          const toSunZ = earthPos.clone().multiplyScalar(-1).normalize();
          const toCamZ = camPos.clone().sub(earthPos);
          const latZ = toCamZ.clone().addScaledVector(toSunZ, -toCamZ.dot(toSunZ));
          if (latZ.lengthSq() < 1e-4) latZ.set(0, 1, 0);
          latZ.normalize();
          aim.copy(earthPos)
            .addScaledVector(toSunZ, 0.45 * pr * 5.2)
            .addScaledVector(latZ, 0.89 * pr * 5.2);
          camPos.lerp(aim, wtZoom);
        }
      }

      // 俯冲地球：转场开始的瞬间定好收尾机位——落在地球「向阳侧偏 65°」，
      // 地球大面积受光、太阳落在画外，镜头沿一条缓缓上抛的直线滑过去。
      const dive = st.dive || 0;
      if (dive > 0.001) {
        earthMesh.updateWorldMatrix(true, false);
        earthMesh.getWorldPosition(earthPos);
        if (divePrev <= 0.001) {
          earthStart.copy(earthPos);
          const toSun = earthStart.clone().multiplyScalar(-1).normalize(); // 地球 → 太阳
          const toCam = camPos.clone().sub(earthStart);
          const lat = toCam.clone().addScaledVector(toSun, -toCam.dot(toSun));
          if (lat.lengthSq() < 1e-4) lat.set(0, 1, 0);
          lat.normalize();
          diveDir.copy(toSun).multiplyScalar(0.42).addScaledVector(lat, 0.91).normalize();
          diveStart.copy(camPos);
        }
        aim.copy(earthPos).addScaledVector(diveDir, EARTH_R * 3.05);
        aim.y += Math.sin(Math.PI * dive) * EARTH_R * 1.4; // 轻微上抛，轨迹不那么死板
        camPos.lerpVectors(diveStart, aim, dive);
        // 视线从太阳平滑摆到地球身上
        lookTarget.copy(earthPos).multiplyScalar(smooth01((dive - 0.05) / 0.35));
        fov = THREE.MathUtils.lerp(fov, 38, smooth01(dive * 1.05));
      } else {
        lookTarget.copy(trackCenter);
        if (wtZoom > 0.001) lookTarget.lerp(earthPos, wtZoom);
      }
      divePrev = dive;

      /* ---------- 层级 3 / 4：锁定某颗行星（轮播 / 特写） ---------- */
      // 特写里手势既转行星本体，也让相机绕着它挪一点：背景星场与其他行星才会真的动
      const dYawCam = st.detailYaw || 0;
      const dPitchCam = THREE.MathUtils.clamp(st.detailPitch || 0, -1.5, 1.5);
      const focusAmt = THREE.MathUtils.clamp(st.focusAmt || 0, 0, 1);
      const detailAmt = THREE.MathUtils.clamp(st.detailAmt || 0, 0, 1);
      const fi = st.focus == null ? -1 : st.focus;
      if (focusAmt > 0.0005 && planets[fi]) {
        const camFor = (idxPlanet, outPos, outLook) => {
          const pl = planets[idxPlanet];
          pl.mesh.getWorldPosition(outLook);
          const toSun = outLook.clone().multiplyScalar(-1).normalize();
          const side = new THREE.Vector3(-outLook.z, 0, outLook.x);
          if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
          side.multiplyScalar(st.focusSide || 1);
          side.normalize();
          const dir = toSun.multiplyScalar(0.52).addScaledVector(side, 0.85).normalize();
          const R = pl.data.size;
          const d = R * (5.2 + (3.2 - 5.2) * detailAmt);
          outPos.copy(outLook).addScaledVector(dir, d);
        };

        const aPos = new THREE.Vector3();
        const aLook = new THREE.Vector3();
        camFor(fi, aPos, aLook);

        const prevFi = (st.focusPrev == null || !planets[st.focusPrev]) ? fi : st.focusPrev;
        const blend = st.focusBlend == null ? 1 : st.focusBlend;
        const fPos = new THREE.Vector3();
        const fLook = new THREE.Vector3();
        if (blend < 1 && prevFi !== fi) {
          const bPos = new THREE.Vector3();
          const bLook = new THREE.Vector3();
          camFor(prevFi, bPos, bLook);
          const e = blend * blend * (3 - 2 * blend);
          fPos.copy(bPos).lerp(aPos, e);
          fPos.y += Math.sin(Math.PI * e) * 7.5;   // 沿轨道绕过去的弧
          fLook.copy(bLook).lerp(aLook, e);
        } else {
          fPos.copy(aPos);
          fLook.copy(aLook);
        }

        // 选中行星加一圈柔和光晕（球体做深度遮挡，只有外圈可见）
        planets[fi].mesh.getWorldPosition(focusHalo.position);
        const hR = planets[fi].data.size;
        const hS = hR * (2.15 + 0.55 * detailAmt) * (0.90 + 0.10 * focusAmt);
        focusHalo.scale.set(hS, hS, 1);
        focusHalo.material.opacity = 0.14 * focusAmt;
        focusHalo.visible = true;

        // 和「太阳系全景」机位混合：focusAmt = 0 时完全回到全景
        camPos.lerp(fPos, focusAmt);
        lookTarget.lerp(fLook, focusAmt);

        // 相机绕行星做小幅环绕（±约 26°），把「换观测角度」做实
        const orbitAmt = THREE.MathUtils.smoothstep(detailAmt, 0.35, 1.0);
        if (orbitAmt > 0.001 && planets[fi]) {
          const cp = planets[fi].mesh.getWorldPosition(camPos.clone());
          const off = camPos.clone().sub(cp);
          const r = off.length();
          const az = Math.atan2(off.x, off.z) + dYawCam * 0.45 * orbitAmt;
          const el = THREE.MathUtils.clamp(
            Math.asin(THREE.MathUtils.clamp(off.y / r, -1, 1)) + dPitchCam * 0.34 * orbitAmt,
            -1.2, 1.2
          );
          off.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
          camPos.copy(cp).add(off);
        }
        fov = THREE.MathUtils.lerp(fov, 46 - 6 * detailAmt, focusAmt);
      }

      if (focusAmt <= 0.0005) focusHalo.visible = false;

      camera.position.copy(camPos);
      camera.lookAt(lookTarget);
      camera.fov = fov;
      camera.updateProjectionMatrix();

      // 越靠近太阳越压暗它的亮度与辉光，避免俯冲途中整块过曝
      const camDist = camera.position.length();
      const sunProx = 1 - THREE.MathUtils.smoothstep(camDist, 10, 46);
      const dim = 1 - 0.78 * dive * (0.42 + 0.58 * sunProx);
      // 相机贴近时（俯冲尾声、进场第一帧）太阳会占满屏幕：连辉光球一起收，
      // 否则那两个屏幕空间的大光球会把整帧刷成一片白
      const near = THREE.MathUtils.clamp((camDist - 12) / 52, 0, 1);
      // 进场时太阳从「一点冷光」渐渐点亮：亮度与光晕一起爬升，避免一落地就是个大光球
      const rise = THREE.MathUtils.clamp((arrive - 0.55) / 0.42, 0, 1);
      const riseE = rise * rise * (3 - 2 * rise);
      sunUniforms.uDim.value = dim * (0.62 + 0.38 * near) * (0.30 + 0.70 * riseE) * sRev;
      const glowScale = THREE.MathUtils.clamp(camDist / 74, 0.26, 1.10) * (0.35 + 0.65 * sRev);
      sunGlow.scale.set(2.13 * glowScale, 2.13 * glowScale, 1);
      sunHalo.scale.set(3.87 * glowScale, 3.87 * glowScale, 1);
      // 大尺寸辉光是屏幕空间的大球，贴近时会把整帧刷成橙色，直接淡出
      sunGlow.material.opacity = (0.20 + Math.sin(t * 2.2) * 0.025) * dim * (1 - 0.92 * dive) * (0.18 + 0.82 * near) * (0.22 + 0.78 * riseE) * sRev;
      sunHalo.material.opacity = (0.035 + Math.sin(t * 1.1) * 0.010) * dim * (1 - 0.88 * dive) * (0.14 + 0.86 * near) * (0.18 + 0.82 * riseE) * sRev;
      // 贴近地球时轨道线会从镜头前横穿过去，淡出它
      orbitLineMat.opacity = 0.22 * (1 - 0.92 * dive);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
  return state;
}
