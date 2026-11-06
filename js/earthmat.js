import * as THREE from 'three';

/**
 * 地球的三层「皮肤」，银河场景和太阳系场景共用：
 *   surface   地表——蓝大理石贴图 + 真实晨昏线 + 海面窄高光 + 夜面城市灯 + 临边散射
 *   clouds    云层——白色云 + 受光侧亮、夜侧压暗
 *   atmo      大气——很薄的一圈菲涅尔散射，只在向阳侧亮
 *
 * 三个材质都不吃场景灯光，太阳方向由 uniforms.uSunDir（世界空间、从地心指向太阳）驱动，
 * 这样地球在太阳系里绕日公转时，光照会自动跟着转。
 */

const SURFACE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main(){
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SURFACE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uWater;
  uniform vec3 uSunDir;
  uniform float uNightGain;
  uniform float uReveal;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;

  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSunDir);

    float ndl = dot(N, L);
    // 晨昏线：一小段柔和过渡，不是硬切线
    float day = smoothstep(-0.08, 0.12, ndl);

    vec3 albedo = texture2D(uDay, vUv).rgb;
    // 真实的地球颜色偏低饱和，稍微去一点艳、再压暗一档
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    albedo = mix(vec3(lum), albedo, 0.80) * 0.90;

    float water = texture2D(uWater, vUv).r;   // 1 = 海洋

    // 海洋压深、偏靛蓝：真实地球的海水远比贴图默认色更深
    albedo = mix(albedo, albedo * vec3(0.52, 0.74, 1.02), water * 0.85);

    // 海面高光：很窄的一束，只在受光面出现
    vec3 H = normalize(L + V);
    float spec = min(pow(max(dot(N, H), 0.0), 620.0) * water * 0.50 * day, 0.30);

    // 夜面城市灯：只出现在陆地上
    vec3 lights = texture2D(uNight, vUv).rgb * vec3(1.0, 0.78, 0.52);
    float nightMask = (1.0 - day) * (1.0 - min(water * 1.02, 1.0)) * uNightGain;

    vec3 col = albedo * (0.045 + 1.16 * max(ndl, 0.0));
    col += vec3(1.0, 0.94, 0.86) * spec;
    col += lights * nightMask;

    // 临边散射：地平线附近那圈薄蓝光，夜侧几乎不留
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.6);
    col += vec3(0.30, 0.55, 1.0) * fres * (0.10 + 0.90 * day) * 0.80;

    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uClouds;
  uniform vec3 uSunDir;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;

  void main(){
    float a = texture2D(uClouds, vUv).a;
    if (a < 0.004) discard;

    vec3 N = normalize(vN);
    vec3 L = normalize(uSunDir);
    float lit = smoothstep(-0.20, 0.28, dot(N, L));

    vec3 col = mix(vec3(0.03, 0.05, 0.09), vec3(1.0), pow(lit, 0.72));
    gl_FragColor = vec4(col, a * uOpacity * (0.18 + 0.90 * lit));
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vW;

  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSunDir);
    float f = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    float day = smoothstep(-0.30, 0.40, dot(N, L));
    gl_FragColor = vec4(uColor, f * (0.05 + 0.95 * day) * uStrength);
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SUN = new THREE.Vector3(0, 0, 1);

/** 地表球体 */
export function createEarthSurface({ day, night, water, radius = 1, segments = 128, sunDir = SUN, nightGain = 1.0 }) {
  const uniforms = {
    uDay: { value: day || null },
    uNight: { value: night || null },
    uWater: { value: water || null },
    uSunDir: { value: sunDir.clone() },
    uNightGain: { value: nightGain },
    uReveal: { value: 1 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments),
    new THREE.ShaderMaterial({ uniforms, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG })
  );
  mesh.name = 'earthSurface';
  return { mesh, uniforms };
}

/** 云层壳（与地表同半径略放大，避免 z-fighting） */
export function createCloudShell({ clouds, radius = 1, segments = 96, sunDir = SUN, opacity = 0.96 }) {
  const uniforms = {
    uClouds: { value: clouds || null },
    uSunDir: { value: sunDir.clone() },
    uOpacity: { value: opacity },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.006, segments, segments),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SURFACE_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    })
  );
  mesh.name = 'earthClouds';
  return { mesh, uniforms };
}

/** 大气壳：一层很薄的散射，位置在最外层 */
export function createAtmoShell({ radius = 1, segments = 96, sunDir = SUN, color = 0x5aa9ff, strength = 0.6, scale = 1.018 }) {
  const uniforms = {
    uSunDir: { value: sunDir.clone() },
    uColor: { value: new THREE.Color(color) },
    uStrength: { value: strength },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * scale, segments, segments),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    })
  );
  mesh.name = 'earthAtmo';
  return { mesh, uniforms };
}