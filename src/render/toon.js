import * as THREE from 'three';
import { COL } from './palette.js';

// Shared by every toon material; hatch spacing follows device pixels.
export const TOON = {
  hatch: { value: 7 },
  flat: false, // read at material creation: solid ink shadows, no hatching
};

// Light rig is calibrated so that, after Lambert's 1/PI, a face fully turned
// to the sun reads k≈1 and a face in shadow reads k≈0.29.
export const LIGHT = { sun: 2.25, ambient: 0.9 };

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
    _col = _base * uMid;
  } else {
    _col = mix(_base * 0.5, uInk, uShadeInk);
    float h = mod(gl_FragCoord.x - gl_FragCoord.y, uHatch);
    if (uHatchOn > 0.5 && h < uHatch * 0.22) _col = mix(_col, uInk, 0.8);
  }
  gl_FragColor = vec4(_col, diffuseColor.a);
`;

/**
 * Three-band cel material: lit / mid / inked shadow with diagonal hatching.
 * Built on Lambert so shadow maps and fog keep working.
 */
export function toon(color, { map = null, mid = 0.8, shadeInk = 0.5, hatch = true, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, map, side });
  m.onBeforeCompile = (s) => {
    s.uniforms.uInk = { value: COL.ink };
    s.uniforms.uMid = { value: mid };
    s.uniforms.uShadeInk = { value: TOON.flat ? Math.max(shadeInk, 0.78) : shadeInk };
    s.uniforms.uHatchOn = { value: hatch && !TOON.flat ? 1 : 0 };
    s.uniforms.uHatch = TOON.hatch;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInk;\nuniform float uMid, uShadeInk, uHatchOn, uHatch;')
      .replace('#include <opaque_fragment>', CHUNK);
  };
  m.customProgramCacheKey = () => 'toon-v1';
  return m;
}

/** Flat, unlit fill for decals and effects. */
export function flat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
