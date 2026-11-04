import * as THREE from 'three';
import { GLSL_NOISE, makeGlowTexture } from '../util.js';
import { createEarthSurface, createCloudShell, createAtmoShell } from '../earthmat.js';
import { createPlanetMaterial } from '../planetmat.js';

const PLANETS = [
  { name: 'mercury', tex: 'mercury', size: 0.72, orbit: 8.2, period: 0.241, spin: 0.15, color: 0x9a8f86,
    atmo: 0x9a8f86, rim: 0.0, spec: 0.02, relief: 0.9, contrast: 0.10 },
  { name: 'venus', tex: 'venus', size: 1.5, orbit: 11.0, period: 0.615, spin: 0.08, color: 0xd9b98a,
    atmo: 0xffd9a0, rim: 0.12, spec: 0.0, relief: 0.18, contrast: 0.06 },
  { name: 'earth', tex: 'earth', size: 1.6, orbit: 14.2, period: 1.0, spin: 0.9, color: 0x4f8fd0 },
  { name: 'mars', tex: 'mars', size: 1.05, orbit: 17.6, period: 1.881, spin: 0.85, color: 0xb5502e,
    atmo: 0xd08a5a, rim: 0.07, spec: 0.03, relief: 0.6, contrast: 0.14 },
  { name: 'jupiter', tex: 'jupiter', size: 4.4, orbit: 25.5, period: 11.86, spin: 2.0, color: 0xc8a887,
    atmo: 0xffe2b8, rim: 0.15, spec: 0.0, relief: 0.06, contrast: 0.12 },
  { name: 'saturn', tex: 'saturn', size: 3.8, orbit: 33.0, period: 29.46, spin: 1.8, color: 0xd6c08a, ring: true,
    atmo: 0xffe8c6, rim: 0.15, spec: 0.0, relief: 0.04, contrast: 0.10 },
  { name: 'uranus', tex: 'uranus', size: 2.5, orbit: 39.5, period: 84.0, spin: 1.4, color: 0x8fd3de,
    atmo: 0x9fe6ff, rim: 0.24, spec: 0.02, relief: 0.02, contrast: 0.05 },
  { name: 'neptune', tex: 'neptune', size: 2.4, orbit: 45.5, period: 164.8, spin: 1.3, color: 0x4a6fd0,
    atmo: 0x6fa8ff, rim: 0.24, spec: 0.02, relief: 0.02, contrast: 0.08 },
];

export function createSolar(pixelRatio, tex) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 6000);

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
          col *= 1.02 * uDim;
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
  sunGlow.scale.set(21, 21, 1);
  scene.add(sunGlow);

  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex, color: 0xffb070, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32,
    })
  );
  sunHalo.scale.set(44, 44, 1);
  scene.add(sunHalo);

  // 行星材质全走自绘 shader，不再需要场景灯光（太阳方向由 uniform 传进去）
  scene.add(new THREE.AmbientLight(0x35507f, 0.85));

  /* ---------------- 行星 ---------------- */
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  const planets = [];
  const orbitLineMat = new THREE.LineBasicMaterial({ color: 0x3f7bb5, transparent: true, opacity: 0.22 });
  const ringTex = tex.ring || null;
  let earthSurface = null;
  let earthCloudShell = null;

  PLANETS.forEach((p, idx) => {
    const pivot = new THREE.Object3D();
    pivot.rotation.z = (Math.random() - 0.5) * 0.07;
    pivot.rotation.x = (Math.random() - 0.5) * 0.05;
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
      mesh = new THREE.Mesh(new THREE.SphereGeometry(p.size, 64, 48), pm.material);
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
  for (let i = 0; i < beltN; i++) {
    const r = 20.2 + Math.random() * 2.6;
    const a = Math.random() * Math.PI * 2;
    beltPos[i * 3] = Math.cos(a) * r;
    beltPos[i * 3 + 1] = (Math.random() - 0.5) * 0.75;
    beltPos[i * 3 + 2] = Math.sin(a) * r;
    const b = 0.10 + Math.random() * 0.22;
    beltCol[i * 3] = b; beltCol[i * 3 + 1] = b * 0.92; beltCol[i * 3 + 2] = b * 0.8;
    beltSize[i] = 0.4 + Math.random() * 1.1;
  }
  const beltGeo = new THREE.BufferGeometry();
  beltGeo.setAttribute('position', new THREE.BufferAttribute(beltPos, 3));
  beltGeo.setAttribute('aColor', new THREE.BufferAttribute(beltCol, 3));
  beltGeo.setAttribute('aSize', new THREE.BufferAttribute(beltSize, 1));

  const beltPoints = new THREE.Points(
    beltGeo,
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (120.0 / max(-mv.z, 1.0));
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

  /* ---------------- 流动星河背景 ---------------- */
  const skyUniforms = { uTime: { value: 0 } };
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

          vec3 cDeep  = vec3(0.0030, 0.0060, 0.0170);
          vec3 cBlue  = vec3(0.0200, 0.0550, 0.1500);
          vec3 cWhite = vec3(0.1150, 0.1300, 0.1900);
          vec3 cAmber = vec3(0.2200, 0.1500, 0.0800);
          vec3 cRed   = vec3(0.1200, 0.0350, 0.0450);
          vec3 cTeal  = vec3(0.0200, 0.0900, 0.1100);

          vec3 col = mix(cDeep, cBlue, smoothstep(0.30, 0.85, n1) * 0.9);
          col += cWhite * pow(band, 3.0) * (0.04 + 0.18 * smoothstep(0.52, 0.96, n2));
          col += cAmber * pow(gwCore, 2.0) * 0.28;

          // 尘埃带：把银河切出一条条暗缝
          float dust = smoothstep(0.54, 0.66, fbm3(q * 4.2 + 31.0)) * pow(band, 1.6);
          col *= 1.0 - dust * 0.45;

          // 零星发射星云（Hα 偏红 + 少量青绿）
          float neb = pow(smoothstep(0.68, 0.99, n3), 2.6) * band;
          col += cRed * neb * 0.35 + cTeal * neb * 0.14;

          // 极细的星尘
          float sp = pow(fbm3(dir * 190.0 + vec3(uTime * 0.05)), 10.0);
          col += vec3(0.62, 0.80, 1.0) * sp * 0.60;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // 星河颗料（三层视差，缓慢流动）
  const layers = [];
  const starSprite = new THREE.CanvasTexture(makeGlowTexture('rgba(255,255,255,1)', 'rgba(190,220,255,0.6)', 64));
  for (let L = 0; L < 3; L++) {
    const count = [2600, 2000, 1400][L];
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const radius = [520, 760, 1050][L];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const yb = (Math.random() - 0.5);
      const spread = 0.55 + Math.random() * 0.35;
      const r = radius * (0.85 + Math.random() * 0.3);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = yb * r * 0.36 * spread;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.6 + Math.cos(a * 2.0) * r * 0.12;
      const b = 0.3 + Math.pow(Math.random(), 2.2) * 0.85;
      col[i * 3] = b * (0.75 + Math.random() * 0.3);
      col[i * 3 + 1] = b * (0.82 + Math.random() * 0.2);
      col[i * 3 + 2] = b;
      size[i] = (0.8 + Math.pow(Math.random(), 3) * 2.6) * (L === 0 ? 1.2 : 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uMap: { value: starSprite } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (900.0 / max(-mv.z, 1.0));
          gl_PointSize = clamp(gl_PointSize, 1.0, 9.0 * uPixelRatio);
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = dot(uv, uv);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor, pow(1.0 - d, 2.2));
        }
      `,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = -5 + L;
    scene.add(p);
    layers.push({ points: p, mat: m, speed: [0.012, 0.02, 0.032][L] });
  }

  /* ---------------- 更新 ---------------- */
  let t = 0;
  const state = {
    name: 'solar',
    scene,
    camera,
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
      sun.rotation.y = sunUniforms.uSpin.value;

      // 俯冲时整场节奏放慢一点（电影感），别让地球跑得太快
      const slow = 1 - 0.8 * (st.dive || 0);
      planets.forEach((p) => {
        p.angle += dt * p.speed * slow;
        p.mesh.position.x = Math.cos(p.angle) * p.data.orbit;
        p.mesh.position.z = Math.sin(p.angle) * p.data.orbit;
        p.mesh.rotation.y += dt * p.spin;
        // 每颗行星的「太阳方向」= 它自己指向原点（太阳在原点）
        const mu = p.mesh.userData.pmat;
        if (mu) {
          p.mesh.getWorldPosition(sunDirTmp);
          mu.uSunDir.value.copy(sunDirTmp).negate().normalize();
        }
      });
      if (earthClouds) earthClouds.rotation.y += dt * 0.018;
      // 地球的太阳方向：太阳在原点，方向就是「地心 → 原点」
      if (earthSurface) {
        earthMesh.getWorldPosition(sunDirTmp);
        earthSurface.uniforms.uSunDir.value.copy(sunDirTmp).negate().normalize();
      }

      beltPoints.rotation.y += dt * 0.02;
      layers.forEach((l) => { l.points.rotation.y += dt * l.speed; });
      orbitGroup.rotation.y += dt * 0.006;

      const e = Math.pow(st.dolly, 1.25);
      // 进场：从太阳表面附近快速拉远到全景（配合银河 → 太阳系的转场）
      const arrive = st.solarArrive == null ? 1 : st.solarArrive;
      const dist = THREE.MathUtils.lerp(86, 26, e) * arrive;
      camPos.set(
        Math.sin(st.yaw) * Math.cos(st.pitch) * dist,
        Math.sin(st.pitch) * dist,
        Math.cos(st.yaw) * Math.cos(st.pitch) * dist
      );
      let fov = THREE.MathUtils.lerp(48, 60, e);

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
        aim.copy(earthPos).addScaledVector(diveDir, EARTH_R * 2.05);
        aim.y += Math.sin(Math.PI * dive) * EARTH_R * 1.4; // 轻微上抛，轨迹不那么死板
        camPos.lerpVectors(diveStart, aim, dive);
        // 视线从太阳平滑摆到地球身上
        lookTarget.copy(earthPos).multiplyScalar(smooth01((dive - 0.05) / 0.35));
        fov = THREE.MathUtils.lerp(fov, 38, smooth01(dive * 1.05));
      } else {
        lookTarget.set(0, 0, 0);
      }
      divePrev = dive;

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
      sunUniforms.uDim.value = dim * (0.62 + 0.38 * near);
      const glowScale = THREE.MathUtils.clamp(camDist / 74, 0.26, 1.10);
      sunGlow.scale.set(21 * glowScale, 21 * glowScale, 1);
      sunHalo.scale.set(44 * glowScale, 44 * glowScale, 1);
      // 大尺寸辉光是屏幕空间的大球，贴近时会把整帧刷成橙色，直接淡出
      sunGlow.material.opacity = (0.58 + Math.sin(t * 2.2) * 0.06) * dim * (1 - 0.92 * dive) * (0.18 + 0.82 * near);
      sunHalo.material.opacity = (0.13 + Math.sin(t * 1.1) * 0.03) * dim * (1 - 0.88 * dive) * (0.14 + 0.86 * near);
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
