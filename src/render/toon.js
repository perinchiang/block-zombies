import * as THREE from 'three';
import { COL } from './palette.js';

// Shared by every toon material; dot spacing follows device pixels.
export const TOON = {
  hatch: { value: 7 },
  flat: false, // read at material creation: solid ink shadows, no dots
};

// Light rig is calibrated so that, after Lambert's 1/PI, a face fully turned
// to the sun reads k≈1 and a face in shadow reads k≈0.29.
export const LIGHT = { sun: 2.25, ambient: 0.9 };

// Coloured-comic banding: lit = the colour, mid = a slightly cooler step,
// shadow = the colour pushed toward violet, printed with halftone dots.
const CHUNK = /* glsl */ `
  vec3 _base = diffuseColor.rgb;
  float _lb = dot(_base, vec3(0.299, 0.587, 0.114));
  float _ll = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  float _k = _ll / max(_lb, 0.02);
  vec3 _col;
  if (_lb < 0.03) {
    _col = _base;                       // drawn ink stays ink
  } else if (_k > 0.64) {
    _col = _base;
  } else if (_k > 0.4) {
    _col = mix(_base * uMid, uShade, 0.08);
  } else {
    _col = mix(_base * 0.62, uShade, 0.3);
    _col = mix(_col, uInk, uShadeInk);
    if (uHatchOn > 0.5) {
      // 45-degree halftone screen, dots a touch darker than the shadow fill
      vec2 _p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / uHatch;
      float _d = length(fract(_p) - 0.5);
      _col = mix(_col, _col * 0.62 + uShade * 0.12, 1.0 - smoothstep(0.26, 0.31, _d));
    }
  }
  gl_FragColor = vec4(_col, diffuseColor.a);
`;

/**
 * Three-band cel material: lit / mid / violet shadow with halftone dots.
 * Built on Lambert so shadow maps and fog keep working.
 * `shadeInk` (0..1) pushes the shadow toward ink for small dark parts.
 */
export function toon(color, { map = null, mid = 0.84, shadeInk = 0, hatch = true, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, map, side });
  m.onBeforeCompile = (s) => {
    s.uniforms.uInk = { value: COL.ink };
    s.uniforms.uShade = { value: COL.shadow };
    s.uniforms.uMid = { value: mid };
    s.uniforms.uShadeInk = { value: TOON.flat ? 0.7 : shadeInk };
    s.uniforms.uHatchOn = { value: hatch && !TOON.flat ? 1 : 0 };
    s.uniforms.uHatch = TOON.hatch;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInk, uShade;\nuniform float uMid, uShadeInk, uHatchOn, uHatch;')
      .replace('#include <opaque_fragment>', CHUNK);
  };
  m.customProgramCacheKey = () => 'toon-v2';
  return m;
}

/** Flat, unlit fill for decals and effects. */
export function flat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
