import * as THREE from 'three';
import { COL } from './palette.js';

// Screen-space comic outlines. The scene is drawn once for colour + depth and
// once for view-space normals; a final pass inks silhouettes (from inverse
// depth, which is linear across flat surfaces) and creases (from normals).
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor, tNormal, tDepth;
  uniform vec2 uTexel;
  uniform float uNear, uFar, uLine, uFogNear, uFogFar;
  uniform vec3 uInk;
  varying vec2 vUv;

  float invZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return -1.0 / perspectiveDepthToViewZ(d, uNear, uFar);
  }
  vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float iz = invZ(vUv);
    float z = 1.0 / max(iz, 1e-5);
    // Thinner lines with distance. Pen pressure varies only gently: strong
    // jitter broke short edges on small parts into scribble.
    float w = uLine * clamp(8.0 / z, 0.45, 1.0) * (0.92 + 0.16 * hash(floor(vUv * vec2(12.0, 7.0))));
    vec2 dx = vec2(uTexel.x * w, 0.0), dy = vec2(0.0, uTexel.y * w);

    float l = invZ(vUv - dx), r = invZ(vUv + dx), u = invZ(vUv + dy), d = invZ(vUv - dy);
    float lap = abs(l + r - 2.0 * iz) + abs(u + d - 2.0 * iz);
    float edgeD = smoothstep(0.05, 0.12, lap / max(iz, 1e-5));

    vec3 n = nrm(vUv);
    float c = min(min(dot(n, nrm(vUv - dx)), dot(n, nrm(vUv + dx))), min(dot(n, nrm(vUv + dy)), dot(n, nrm(vUv - dy))));
    float edgeN = smoothstep(0.55, 0.3, c);

    float edge = max(edgeD, edgeN);
    edge *= 1.0 - 0.9 * smoothstep(uFogNear, uFogFar, z);
    col = mix(col, uInk, edge);

    // Paper tooth and a soft vignette.
    col *= 0.975 + 0.035 * hash(floor(gl_FragCoord.xy * 0.5));
    vec2 q = vUv - 0.5;
    col *= 1.0 - 0.22 * dot(q, q);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Objects on this layer are drawn in colour only: no outline, no crease lines. */
export const NO_INK_LAYER = 1;

export class InkLine {
  constructor(renderer) {
    this.renderer = renderer;
    this.depth = new THREE.DepthTexture(1, 1);
    this.color = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: this.depth });
    this.normal = new THREE.WebGLRenderTarget(1, 1);
    this.normalMat = new THREE.MeshNormalMaterial();
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tColor: { value: this.color.texture },
          tNormal: { value: this.normal.texture },
          tDepth: { value: this.depth },
          uTexel: { value: new THREE.Vector2() },
          uNear: { value: 0.1 },
          uFar: { value: 100 },
          uLine: { value: 2 },
          uFogNear: { value: 14 },
          uFogFar: { value: 40 },
          uInk: { value: COL.ink },
        },
      }),
    );
    this.quad.frustumCulled = false;
    this.post = new THREE.Scene();
    this.post.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, cssLineWidth = 2.2) {
    this.color.setSize(w, h);
    this.normal.setSize(w, h);
    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / w, 1 / h);
    // Line width is specified in CSS pixels and scaled to the drawing buffer.
    u.uLine.value = cssLineWidth * (this.renderer.getPixelRatio());
  }

  render(scene, camera, fog) {
    const r = this.renderer;
    const u = this.quad.material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    if (fog) { u.uFogNear.value = fog.near; u.uFogFar.value = fog.far; }

    r.setRenderTarget(this.color);
    r.render(scene, camera);

    const bg = scene.background, f = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.normal);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    camera.layers.disable(NO_INK_LAYER);
    r.render(scene, camera);
    camera.layers.enable(NO_INK_LAYER);
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = f;

    r.setRenderTarget(null);
    r.render(this.post, this.postCam);
  }
}
