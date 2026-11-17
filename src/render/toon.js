import * as THREE from 'three';
import { COL } from './palette.js';

export const TOON = {
  flat: false, // read at material creation: solid ink shadows for comparison
};

// Light rig is calibrated so that, after Lambert's 1/PI, a face fully turned
// to the sun reads k≈1 and a face in shadow reads k≈0.29.
export const LIGHT = { sun: 2.25, ambient: 0.9 };

// Coloured-comic banding: lit = the colour, mid = a slightly cooler step,
// shadow = the colour pushed toward violet. Shadows are plain fills: any
// screen-space pattern (hatching, halftone) stays put while surfaces slide
// under it, which reads as dirt on the screen whenever the camera moves.
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
  }
  gl_FragColor = vec4(_col, diffuseColor.a);
`;

/**
 * Three-band cel material: lit / mid / violet shadow.
 * Built on Lambert so shadow maps and fog keep working.
 * `shadeInk` (0..1) pushes the shadow toward ink for small dark parts.
 */
export function toon(color, { map = null, mid = 0.84, shadeInk = 0, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, map, side });
  m.onBeforeCompile = (s) => {
    s.uniforms.uInk = { value: COL.ink };
    s.uniforms.uShade = { value: COL.shadow };
    s.uniforms.uMid = { value: mid };
    s.uniforms.uShadeInk = { value: TOON.flat ? 0.7 : shadeInk };
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInk, uShade;\nuniform float uMid, uShadeInk;')
      .replace('#include <opaque_fragment>', CHUNK);
  };
  m.customProgramCacheKey = () => 'toon-v3';
  return m;
}

/** Flat, unlit fill for decals and effects. */
export function flat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
