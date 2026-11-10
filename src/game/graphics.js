// Catena di rendering: MSAA, bagliore delle luci (bloom), vignettatura, tone mapping; riflessi d'ambiente.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// bordi dello schermo più scuri, come una ripresa televisiva
const Vignette = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5;
  c.rgb *= 1.0 - uAmount * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  gl_FragColor = c;
}`,
};

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;
    pmrem.dispose();

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(Vignette));
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render() { this.composer.render(); }
}
