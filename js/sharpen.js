import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * 轻微反锐化（unsharp mask）。
 * 后期链一路走 EffectComposer，渲染目标没有 MSAA 时边缘会发糊，
 * 这个 pass 在最终输出上补一点局部对比，让星点、行星边缘、土星环更“实”。
 */
export const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    uStrength: { value: 0.34 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uStrength;
    varying vec2 vUv;

    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0,  uTexel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv + vec2(0.0, -uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2( uTexel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv + vec2(-uTexel.x, 0.0)).rgb;

      vec3 blur = (n + s + e + w) * 0.25;
      vec3 sharp = c.rgb + (c.rgb - blur) * uStrength;

      // 只提亮细节、不把暗部噪点放大：亮度低于阈值时减弱
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float mask = smoothstep(0.015, 0.16, lum);
      sharp = mix(c.rgb, sharp, 0.55 + 0.45 * mask);

      gl_FragColor = vec4(max(sharp, vec3(0.0)), c.a);
    }
  `,
};

export function makeSharpenPass(width = 1600, height = 900, strength = 0.34) {
  const pass = new ShaderPass(SharpenShader);
  pass.material.uniforms.uStrength.value = strength;
  pass.setSize = (w, h) => {
    pass.material.uniforms.uTexel.value.set(1 / Math.max(w, 1), 1 / Math.max(h, 1));
  };
  pass.setSize(width, height);
  return pass;
}