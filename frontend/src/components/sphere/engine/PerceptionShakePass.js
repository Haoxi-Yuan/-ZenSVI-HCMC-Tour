/**
 * PerceptionShakePass — chromatic aberration + radial zoom blur post-processing.
 *
 * Triggered when SHAP delta exceeds threshold during walking.
 * Simulates "cognitive shock" when perception environment changes drastically.
 * Single pass, 8 radial blur samples + RGB channel offset.
 * uIntensity = 1.0 on trigger, linear decay to 0 over 300ms.
 */

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

const PerceptionShakeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    void main() {
      if (uIntensity < 0.01) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 center = vec2(0.5, 0.5);
      vec2 dir = vUv - center;
      float dist = length(dir);

      // Chromatic aberration: offset R and B channels
      float aberration = uIntensity * 0.008;
      float r = texture2D(tDiffuse, vUv + dir * aberration).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * aberration).b;

      vec3 color = vec3(r, g, b);

      // Radial zoom blur (8 samples)
      float blurStrength = uIntensity * 0.015;
      vec3 blur = vec3(0.0);
      float totalWeight = 0.0;
      for (int i = 0; i < 8; i++) {
        float t = float(i) / 7.0;
        float weight = 1.0 - t * 0.5;
        vec2 offset = dir * blurStrength * t;
        blur += texture2D(tDiffuse, vUv - offset).rgb * weight;
        totalWeight += weight;
      }
      blur /= totalWeight;

      // Mix blur into color based on distance from center
      float blurMix = smoothstep(0.1, 0.6, dist) * uIntensity;
      color = mix(color, blur, blurMix);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
}

export class PerceptionShakePass extends ShaderPass {
  constructor() {
    super(PerceptionShakeShader)
    this._decaySpeed = 1.0 / 0.3  // full decay in 300ms
    this._active = false
  }

  /** Trigger the shake effect */
  trigger(intensity = 1.0) {
    this.uniforms.uIntensity.value = intensity
    this._active = true
  }

  /** Call every frame with dt in seconds */
  tick(dt) {
    if (!this._active) return
    const v = this.uniforms.uIntensity.value
    if (v > 0.01) {
      this.uniforms.uIntensity.value = Math.max(0, v - this._decaySpeed * dt)
      this.uniforms.uTime.value += dt
    } else {
      this.uniforms.uIntensity.value = 0
      this._active = false
    }
  }
}
