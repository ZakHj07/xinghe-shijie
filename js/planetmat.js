import * as THREE from 'three';

/**
 * 行星通用材质：不用场景灯光，太阳方向由 uniform 驱动。
 * 相比 MeshStandardMaterial，这里手写了几样在太空里最影响真实感的东西：
 *   · 柔和的晨昏线（wrap 光照），不是一刀切的硬边
 *   · 晨昏线附近的暖色散射
 *   · 边缘变暗（limb darkening），球体才不像贴了张平面图
 *   · 用贴图亮度梯度做的假凹凸，让山脉/云带在斜光下有点起伏
 *   · 气体行星的大气边缘光（Fresnel）
 */
export function createPlanetMaterial({
  map = null,
  tint = 0xffffff,
  atmo = 0x000000,
  rim = 0.0,
  spec = 0.0,
  relief = 0.0,
  contrast = 0.0,
  sunDir = new THREE.Vector3(1, 0, 0),
} = {}) {
  const uniforms = {
    uMap: { value: map },
    uHasMap: { value: map ? 1 : 0 },
    uTint: { value: new THREE.Color(tint) },
    uAtmo: { value: new THREE.Color(atmo) },
    uRim: { value: rim },
    uSpec: { value: spec },
    uRelief: { value: relief },
    uContrast: { value: contrast },
    uSunDir: { value: sunDir },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
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
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform vec3 uTint;
      uniform vec3 uAtmo;
      uniform float uRim;
      uniform float uSpec;
      uniform float uRelief;
      uniform float uContrast;
      uniform vec3 uSunDir;

      void main(){
        vec3 N = normalize(vN);
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vW);

        vec3 base = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(1.0);
        base = mix(vec3(0.5), base, 1.0 + uContrast);
        base = clamp(base, 0.0, 1.0) * uTint;

        // 贴图亮度梯度 → 假的凹凸，斜光时更立体
        float relief = 0.0;
        if (uRelief > 0.001) {
          vec2 e = vec2(0.0018, 0.0018);
          float hL = dot(texture2D(uMap, vUv - vec2(e.x, 0.0)).rgb, vec3(0.33));
          float hR = dot(texture2D(uMap, vUv + vec2(e.x, 0.0)).rgb, vec3(0.33));
          float hD = dot(texture2D(uMap, vUv - vec2(0.0, e.y)).rgb, vec3(0.33));
          float hU = dot(texture2D(uMap, vUv + vec2(0.0, e.y)).rgb, vec3(0.33));
          relief = ((hR - hL) + (hU - hD) * 0.5) * uRelief;
        }

        float ndl = dot(N, L);
        // wrap 光照：晨昏线有过渡带，不是硬切
        float diff = clamp((ndl + 0.10) / 1.10, 0.0, 1.0);
        diff = pow(diff, 1.08);
        diff = clamp(diff + relief * 0.5 * smoothstep(0.0, 0.35, ndl), 0.0, 1.0);

        vec3 col = base * (0.050 + 1.00 * diff);

        // 晨昏线附近的暖色散射（大气把低角度阳光染红）
        col *= mix(vec3(1.0), vec3(1.12, 0.94, 0.82), smoothstep(0.40, 0.01, abs(ndl)) * 0.8);

        // 边缘变暗
        float mu = clamp(dot(N, V), 0.0, 1.0);
        col *= 0.86 + 0.14 * pow(mu, 0.4);

        // 冰面/海面高光
        vec3 H = normalize(L + V);
        float sp = pow(max(dot(N, H), 0.0), 64.0) * uSpec * smoothstep(0.0, 0.25, ndl);
        col += vec3(1.0, 0.96, 0.90) * sp;

        // 大气边缘光
        float rimF = pow(1.0 - mu, 3.4);
        col += uAtmo * rimF * uRim * smoothstep(-0.18, 0.55, ndl);
        // 背光面极淡的一层环境光，避免死黑
        col += uAtmo * 0.012 * (1.0 - smoothstep(-0.2, 0.25, ndl));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  return { material, uniforms };
}