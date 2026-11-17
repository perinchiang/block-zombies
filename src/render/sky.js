import * as THREE from 'three';
import { COL } from './palette.js';

// Comic sky: a warm horizon under a deep blue top. The blend between the two
// is printed as halftone dots rather than a smooth gradient, like a coloured
// comic page. Drawn on the camera so it never runs out of far plane.
const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTop, uMid, uHorizon;
  uniform float uDot;
  varying vec3 vDir;
  float dots(float amount) {
    vec2 p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / uDot;
    float d = length(fract(p) - 0.5);
    return 1.0 - smoothstep(amount - 0.04, amount + 0.02, d);
  }
  void main() {
    float h = normalize(vDir).y;
    // horizon -> warm band, solid
    vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.16, h));
    // warm band -> blue top, printed: dot radius shrinks as the blue takes over
    float t = smoothstep(0.16, 0.5, h);
    float warmDots = dots(0.62 * (1.0 - t));
    col = mix(uTop, col, h < 0.16 ? 1.0 : warmDots);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function makeSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: COL.skyTop },
        uMid: { value: COL.skyMid },
        uHorizon: { value: COL.horizon },
        uDot: { value: 9 },
      },
    }),
  );
  sky.name = 'sky';
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.userData.noBulletCollision = true;
  return sky;
}
