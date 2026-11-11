// Lottatori con i personaggi CC0 di Quaternius (Universal Base Characters + Universal Animation Library),
// gli stessi del gioco di basket. L'abbigliamento (slip, stivali, ginocchiere, nastro ai polsi, maschera)
// è "dipinto" sul corpo da uno shader che usa le coordinate di riposo del modello.
// Le mosse di wrestling sono pose procedurali: ogni osso viene orientato verso una direzione
// (nel sistema del lottatore: x sinistra, y su, z avanti) e sfumato sopra le animazioni.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = './models/quaternius/';
const HAIRS = ['Hair_SimpleParted', 'Hair_Long'];
// volti presi dalle foto (tools/build-faces.py): stesso ritaglio usato nello shader, in multipli della distanza tra gli occhi
const FACES = './models/volti/';
const FACE_W = 2.6, FACE_H = 2.8, FACE_EYE = 1.2;

// catene di ossa orientabili, nell'ordine in cui vanno applicate (prima i genitori)
const CHAINS = {
  spine: ['spine_01', 'neck_01'],
  ual: ['upperarm_l', 'lowerarm_l'], fal: ['lowerarm_l', 'hand_l'],
  uar: ['upperarm_r', 'lowerarm_r'], far: ['lowerarm_r', 'hand_r'],
  thl: ['thigh_l', 'calf_l'], shl: ['calf_l', 'foot_l'],
  thr: ['thigh_r', 'calf_r'], shr: ['calf_r', 'foot_r'],
};
const ORDER = Object.keys(CHAINS);

// fisico da lottatore: torace e spalle più larghi, testa leggermente più piccola in proporzione
const BULK_BONES = { spine_03: 1.08, clavicle_l: 1.05, clavicle_r: 1.05, Head: 0.93 };
const SLIM_BONES = { spine_03: 0.98, clavicle_l: 0.96, clavicle_r: 0.96, Head: 1.0 };   // fisico normale (arbitro)

export async function loadWrestlerModels() {
  const loader = new GLTFLoader();
  const res = await fetch(`${BASE}animazioni.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('animazioni.json non trovato');
  const anim = await res.json();
  // animazioni Mixamo convertite (tools/build-mixamo.mjs): facoltative, sostituiscono le pose fatte a mano
  const mixamo = await fetch('./models/mixamo/mixamo.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { clips: [] })).catch(() => ({ clips: [] }));
  const [char, ...hairs] = await Promise.all([
    loader.loadAsync(`${BASE}ragazzo.gltf`),
    ...HAIRS.map((h) => loader.loadAsync(`${BASE}${h}.gltf`)),
  ]);
  const lightSkin = await new THREE.TextureLoader().loadAsync(`${BASE}T_Superhero_Male_Ligh.jpg`);
  lightSkin.colorSpace = THREE.SRGBColorSpace;
  lightSkin.flipY = false;
  const faces = await fetch(`${FACES}volti.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // le texture dei volti si caricano subito: servono già pronte per i ritratti delle carte
  await Promise.all(Object.keys(faces).map(async (name) => {
    try {
      faces[name].tex = await new THREE.TextureLoader().loadAsync(`${FACES}${name}.png`);
      faces[name].tex.colorSpace = THREE.SRGBColorSpace;
    } catch { delete faces[name]; }
  }));

  const scene = char.scene;
  scene.updateMatrixWorld(true);
  let body = null, eyes = null;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count) body = o;
    if (/eye/i.test(o.material?.name || '')) eyes = o;
  });
  const bone = (n) => scene.getObjectByName(n);

  // quanto ogni vertice appartiene alle braccia (dai pesi dello scheletro): pancia e tronco non le devono gonfiare
  {
    const g = body.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const arm = body.skeleton.bones.map((b) => /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/.test(b.name));
    const a = new Float32Array(si.count);
    for (let i = 0; i < si.count; i++) {
      for (let k = 0; k < 4; k++) if (arm[si.getComponent(i, k)]) a[i] += sw.getComponent(i, k);
    }
    g.setAttribute('aArm', new THREE.BufferAttribute(a, 1));
  }

  // riferimenti anatomici nella posa di riposo, nello spazio della mesh del corpo
  const toLocal = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const W = (n) => bone(n).getWorldPosition(new THREE.Vector3());
  const P = (n) => W(n).applyMatrix4(toLocal);
  const lm = {
    footL: P('foot_l'), calfL: P('calf_l'), thighL: P('thigh_l'), thighR: P('thigh_r'), pelvis: P('pelvis'),
    spine1: P('spine_01'), spine3: P('spine_03'), neck: P('neck_01'), head: P('Head'),
    armL: P('upperarm_l'), foreL: P('lowerarm_l'), handL: P('hand_l'),
  };
  // sistema di riferimento del corpo: x = sinistra, y = su, z = avanti
  const up = lm.head.clone().sub(lm.footL).setX(0).normalize();
  const left = lm.thighL.clone().sub(lm.thighR).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const basis = new THREE.Matrix3().set(left.x, left.y, left.z, up.x, up.y, up.z, fwd.x, fwd.y, fwd.z);
  const L = Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, v.clone().applyMatrix3(basis)]));

  // occhi: altezza e distanza dal centro, per i fori della maschera
  const eye = new THREE.Vector2(0.032, L.head.y + 0.07);
  if (eyes) {
    const pos = eyes.geometry.attributes.position, v = new THREE.Vector3();
    let sx = 0, sy = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(eyes.matrixWorld).applyMatrix4(toLocal).applyMatrix3(basis);
      sx += Math.abs(v.x); sy += v.y;
    }
    eye.set(sx / pos.count, sy / pos.count);
  }

  // punto d'appoggio dei cappelli: centro degli occhi e assi della testa nella posa di riposo (spazio del mondo)
  const hatRef = { pos: new THREE.Vector3(0, L.head.y + 0.07, 0.08).applyMatrix3(basis.clone().transpose()).applyMatrix4(body.matrixWorld), k: 1 };
  if (eyes) {
    const pos = eyes.geometry.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) c.add(v.fromBufferAttribute(pos, i).applyMatrix4(eyes.matrixWorld));
    hatRef.pos.copy(c.divideScalar(pos.count));
  }
  hatRef.up = up.clone().transformDirection(body.matrixWorld);
  hatRef.fwd = fwd.clone().transformDirection(body.matrixWorld);
  hatRef.k = new THREE.Vector3(1, 0, 0).applyMatrix4(body.matrixWorld).sub(new THREE.Vector3().applyMatrix4(body.matrixWorld)).length();

  const box = new THREE.Box3().setFromObject(scene, true);
  const height = box.max.y - box.min.y;
  // misure reali (m) dello scheletro, per altezza dei fianchi e lunghezza delle gambe
  const metric = {
    hip: W('pelvis').y - box.min.y,
    thigh: W('thigh_l').distanceTo(W('calf_l')),
    calf: W('calf_l').distanceTo(W('foot_l')),
  };

  const clips = Object.fromEntries([...anim.clips, ...mixamo.clips].map((cl) => {
    const clip = THREE.AnimationClip.parse(cl);
    clip.uuid = THREE.MathUtils.generateUUID();
    clip.userData = { once: cl.loop === false };
    return [cl.name, clip];
  }));

  return {
    scene, clips, body, basis, L, eye, metric, height, groundOffset: box.min.y,
    hairs: hairs.map((h) => h.scene), lightSkin, faces, hatRef,
    headRestInv: bone('Head').matrixWorld.clone().invert(),
  };
}

// capelli lunghi: le ciocche che pendono davanti agli occhi sembrerebbero sopracciglia enormi sul volto della foto,
// si tagliano (coordinate di riposo del modello: occhi a circa 1.68 m, davanti z > 0)
// cut: altezza sotto la quale i capelli si tagliano (capelli "medi", fino al mento)
function trimBangs(m, cut = 0) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairP;')
      .replace('void main() {', `void main() {\n  if ((vHairP.z > 0.01 && abs(vHairP.x) < 0.098 && vHairP.y < 1.75) || vHairP.y < ${cut.toFixed(3)}) discard;`);
  };
  m.customProgramCacheKey = () => `bwt-hair-long-${cut}`;
}

// fascia sulla fronte (Guido), con l'origine sulla linea degli occhi
function headband(color) {
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.095, 0.022, 32, 1, true),
    new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
  band.rotation.x = -0.3;   // più bassa davanti, sulla fronte
  band.scale.set(0.86, 1, 1.1);
  band.position.set(0, 0.05, -0.012);
  band.castShadow = true;
  return band;
}

// antenne da zanzara (El Mosquito): due steli curvi che partono dalla fronte, con l'origine sulla linea degli occhi
function antennae(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.15 });
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.035, 0.07, 0.075), new THREE.Vector3(s * 0.05, 0.11, 0.075),
      new THREE.Vector3(s * 0.075, 0.145, 0.09), new THREE.Vector3(s * 0.105, 0.16, 0.115),
    ]);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.006, 6), mat);
    stem.castShadow = true;
    g.add(stem);
    // perline lungo lo stelo, come nella maschera vera
    for (let k = 0.4; k <= 1.001; k += 0.2) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), mat);
      bead.position.copy(curve.getPoint(k));
      g.add(bead);
    }
  }
  return g;
}

// cappello da cowboy (misure in metri, con l'origine sulla linea degli occhi)
function cowboyHat(color) {
  const felt = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const hat = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.098, 0), new THREE.Vector2(0.096, 0.07), new THREE.Vector2(0.088, 0.115),
    new THREE.Vector2(0.06, 0.128), new THREE.Vector2(0.02, 0.112), new THREE.Vector2(0, 0.11),
  ], 20), felt);
  crown.scale.set(0.92, 1, 1.12);
  const brimGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.09, 0.004), new THREE.Vector2(0.15, -0.004), new THREE.Vector2(0.2, 0.004), new THREE.Vector2(0.206, 0.012),
  ], 40);
  // falde rialzate ai lati
  const p = brimGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    p.setY(i, p.getY(i) + 0.075 * (x * x) / (r * r + 1e-6) * Math.max(0, (r - 0.11) / 0.1) ** 1.5);
  }
  brimGeo.computeVertexNormals();
  const brim = new THREE.Mesh(brimGeo, felt);
  brim.scale.set(0.95, 1, 1.12);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.099, 0.1, 0.022, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: '#1a120c', roughness: 0.6, side: THREE.DoubleSide }));
  band.scale.set(0.93, 1, 1.13);
  band.position.y = 0.012;
  hat.add(crown, brim, band);
  hat.position.set(0, 0.045, -0.035);
  hat.rotation.x = -0.12;
  hat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return hat;
}

const TOPS = { canotta: 1, body: 2, completo: 3 };
const PATTERNS = { arcobaleno: 1, fiamme: 2 };
const col = (c, fallback = '#000000') => new THREE.Color(c ?? fallback);

// corporatura dal peso: indice di massa corporea -> spessore generale, tronco più largo, pancia
// slim: fisico da persona comune, non da lottatore (braccia e petto più sottili, muscoli lisci)
// lean: lottatore asciutto e longilineo (niente massa in più, muscoli poco scolpiti)
export function buildFromWeight(kg, height, slim = false, lean = false) {
  if (slim) return { inflate: -0.014, torso: 0.02, belly: 0.012, smooth: 1, legs: 0.03 };   // legs: pantaloni morbidi
  if (lean) return { inflate: -0.016, torso: 0, belly: 0, smooth: 1, legs: 0 };
  const bmi = kg / (height * height);
  return {
    inflate: THREE.MathUtils.clamp((bmi - 23) * 0.0022, 0, 0.04),
    torso: THREE.MathUtils.clamp((bmi - 25) * 0.005, 0, 0.085),
    belly: THREE.MathUtils.clamp((bmi - 26) * 0.0085, 0, 0.14),
    // i muscoli scolpiti spariscono sotto la massa
    smooth: THREE.MathUtils.clamp((bmi - 27) / 12, 0, 1),
    legs: 0,
  };
}

// volto dalla foto, proiettato sul davanti della testa allineando gli occhi.
// Senza maschera va sotto occhiali e cappellino; con la maschera va sopra (è il disegno della maschera stessa).
const faceGLSL = (cond) => `
  if (uFaceOn > 0.5 && ${cond} && p.y > yNeck) {
    float ipd = 2.0 * uY2.z * uFaceScale;
    vec2 fuv = vec2(0.5 + p.x / (${FACE_W.toFixed(2)} * ipd), ${(FACE_EYE / FACE_H).toFixed(4)} - (p.y - eyeY) / (${FACE_H.toFixed(2)} * ipd));
    float front = smoothstep(0.1, 0.5, normalize(vRestN).z) * step(uHeadZ - 0.02, p.z);
    if (front > 0.0 && fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
      vec4 f = texture2D(uFace, vec2(fuv.x, 1.0 - fuv.y));
      col = mix(col, f.rgb, f.a * front);
      cloth *= 1.0 - f.a * front;
    }
  }`;

// shell: strato della giacca (completo), una copia del corpo un po' più larga che segue lo stesso scheletro
function gearMaterial(src, models, look, shell = false) {
  const m = src.clone();
  if (look.lightSkin) m.map = models.lightSkin;
  m.color = new THREE.Color(look.skinTint ?? '#ffffff');
  const face = look.face && models.faces[look.face];
  let faceTex = null;
  if (face) {
    faceTex = face.tex;
    // il resto della pelle prende il colorito della foto
    m.color.set(face.skinTint).lerp(new THREE.Color('#ffffff'), 0.35);
  }
  const L = models.L;
  const armDir = L.handL.clone().sub(L.foreL).normalize();
  armDir.x = Math.abs(armDir.x);
  const top = look.top || {};
  const build = buildFromWeight(look.kg ?? 90, look.height, look.slim, look.lean);
  if (m.normalScale) m.normalScale.multiplyScalar(1 - build.smooth * 0.75);
  const u = {
    uBasis: { value: models.basis },
    uTrunks: { value: col(look.trunks) },
    uTrim: { value: col(look.trim) },
    uBoots: { value: col(look.boots) },
    uPads: { value: col(look.pads) },
    uTape: { value: col(look.tape) },
    uMask: { value: col(look.mask) },
    uMaskTrim: { value: col(look.maskTrim, '#ffffff') },
    uBeard: { value: col(look.beard) },
    uCap: { value: col(look.cap) },
    uTop: { value: col(top.color) },
    uTop2: { value: col(top.trim ?? top.color) },
    uTop3: { value: col(top.color3 ?? top.color) },
    // x: maschera, y: arbitro, z: nastro ai polsi, w: barba (lunghezza 0-1, 0 = niente)
    uFlags: { value: new THREE.Vector4(look.mask ? 1 : 0, look.isRef ? 1 : 0, look.tape ? 1 : 0, look.beard ? (look.beardLen ?? 0.5) + 0.01 : 0) },
    // x: tipo di maglia, y: calzamaglia, z: disegno della calzamaglia, w: lunghezza dei pantaloncini (0 slip, 1 lunghi)
    uArmband: { value: col(look.armband) },
    uArmbandOn: { value: look.armband ? 1 : 0 },
    uFlags2: { value: new THREE.Vector4(TOPS[top.kind] ?? 0, look.tights ? 1 : 0, PATTERNS[look.tightsPattern] ?? 0, look.trunksLen ?? 0) },
    uCapOn: { value: look.cap ? 1 : 0 },
    // x: occhiali, y: cravatta a righe
    uExtra: { value: new THREE.Vector4(look.glasses ? 1 : 0, top.tieStripes ? 1 : 0, L.handL.distanceTo(L.foreL), 0) },
    uArmX: { value: Math.abs(L.armL.x) },
    uHeadZ: { value: L.head.z },
    uBuild: { value: new THREE.Vector4(build.inflate, build.belly, build.torso, build.legs) },
    uY: { value: new THREE.Vector4(L.footL.y, L.calfL.y, L.spine1.y, L.neck.y) },
    uY2: { value: new THREE.Vector4(L.pelvis.y, Math.abs(L.thighL.x), models.eye.x, models.eye.y) },
    uChest: { value: L.spine3.y },
    uHand: { value: new THREE.Vector3(Math.abs(L.handL.x), L.handL.y, L.handL.z) },
    uArmDir: { value: armDir },
    uFace: { value: faceTex },
    uFaceOn: { value: faceTex ? 1 : 0 },
    uFaceScale: { value: face?.scale ?? 1 },
    uShell: { value: shell ? 1 : 0 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vRestN;
attribute float aArm;
uniform mat3 uBasis; uniform vec4 uBuild; uniform vec4 uY; uniform vec4 uY2; uniform float uChest; uniform float uArmX; uniform vec3 uHand; uniform float uShell;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position;
vRestN = uBasis * normal;
{
  // corporatura: il corpo si gonfia lungo le normali, la pancia sporge davanti
  vec3 q = uBasis * position;
  float belly = exp(-pow((q.y - (uY.z + 0.05)) / 0.17, 2.0)) * smoothstep(-0.04, 0.08, q.z) * (1.0 - smoothstep(0.1, 0.24, abs(q.x)));
  float body = 1.0 - smoothstep(uY.w - 0.02, uY.w + 0.05, q.y);   // la testa resta com'è, sotto i capelli
  body *= 1.0 - 0.8 * smoothstep(uHand.x - 0.12, uHand.x - 0.04, abs(q.x));   // mani e piedi quasi invariati
  body *= 0.3 + 0.7 * smoothstep(uY.x + 0.04, uY.x + 0.14, q.y);
  // tronco (fianchi, petto, collo) più massiccio, braccia escluse
  float torso = smoothstep(uY2.x - 0.12, uY2.x + 0.02, q.y) * (1.0 - smoothstep(uY.w - 0.04, uY.w + 0.03, q.y))
    * (1.0 - smoothstep(uArmX * 0.55, uArmX * 0.8, abs(q.x)))
    * (1.0 - 0.75 * smoothstep(uChest - 0.12, uChest + 0.02, q.y));   // massa su fianchi e vita, poca su petto e spalle (niente gobba)
  float legs = (1.0 - smoothstep(uY2.x - 0.06, uY2.x + 0.04, q.y)) * smoothstep(uY.x + 0.02, uY.x + 0.1, q.y);
  float notArm = 1.0 - smoothstep(0.1, 0.6, aArm);
  transformed += objectNormal * (uBuild.x * body + (uBuild.y * belly + uBuild.z * torso) * notArm + uBuild.w * legs);
  if (uShell > 0.5) {
    // giacca: stoffa staccata dal corpo, spalle imbottite, falde che si allargano sui fianchi
    float shoulder = exp(-pow((q.y - (uY.w - 0.07)) / 0.07, 2.0)) * smoothstep(uArmX * 0.45, uArmX * 0.9, abs(q.x));
    float flare = (1.0 - smoothstep(uY2.x - 0.12, uY2.x + 0.12, q.y)) * notArm;
    // pantaloni larghi e dritti: più staccati dalla gamba verso la caviglia
    float trousers = (1.0 - smoothstep(uY2.x - 0.1, uY2.x - 0.02, q.y)) * (0.016 + 0.018 * (1.0 - smoothstep(uY.x + 0.06, uY.y + 0.1, q.y)));
    trousers *= smoothstep(uY.x - 0.02, uY.x + 0.04, q.y);
    transformed += objectNormal * ((0.02 + 0.008 * shoulder + 0.02 * flare) * smoothstep(uY2.x - 0.1, uY2.x - 0.06, q.y) + trousers);
  }
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vRestN;
uniform sampler2D uFace; uniform float uFaceOn; uniform float uFaceScale;
uniform mat3 uBasis; uniform vec3 uTrunks; uniform vec3 uTrim; uniform vec3 uBoots; uniform vec3 uPads;
uniform vec3 uTape; uniform vec3 uMask; uniform vec3 uMaskTrim; uniform vec3 uBeard; uniform vec3 uCap;
uniform vec3 uTop; uniform vec3 uTop2; uniform vec3 uTop3; uniform vec4 uFlags; uniform vec4 uFlags2; uniform float uCapOn; uniform vec4 uExtra;
uniform float uArmX; uniform float uHeadZ; uniform float uChest; uniform float uShell;
uniform vec3 uArmband; uniform float uArmbandOn;
uniform vec4 uY; uniform vec4 uY2; uniform vec3 uHand; uniform vec3 uArmDir;
float cloth = 0.0;
float shoe = 0.0;   // scarpe: nere e opache (sotto il faro il nero lucido sembrerebbe pelle)
vec3 rainbow(float t) {
  int i = int(mod(floor(t), 6.0));
  if (i == 0) return vec3(0.9, 0.1, 0.1);
  if (i == 1) return vec3(1.0, 0.55, 0.0);
  if (i == 2) return vec3(1.0, 0.9, 0.1);
  if (i == 3) return vec3(0.1, 0.7, 0.2);
  if (i == 4) return vec3(0.1, 0.35, 0.9);
  return vec3(0.5, 0.15, 0.7);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 p = uBasis * vRest;          // x sinistra, y su, z avanti
  float ax = abs(p.x);
  float yFoot = uY.x, yKnee = uY.y, yWaist = uY.z, yNeck = uY.w;
  float yPelvis = uY2.x, xThigh = uY2.y, eyeY = uY2.w;
  float bootTop = mix(yFoot, yKnee, 0.6);
  bool leg = ax < xThigh + 0.2 && p.y < yWaist + 0.01;
  vec3 col = diffuseColor.rgb;

  // calzamaglia lunga fino agli stivali, con disegno
  if (uFlags2.y > 0.5 && leg && p.y > bootTop - 0.02) {
    col = uTrunks; cloth = 1.0;
    float around = atan(p.z, p.x - sign(p.x) * xThigh);
    if (uFlags2.z > 0.5 && uFlags2.z < 1.5 && p.x > 0.0 && p.x > xThigh + 0.025 && p.y > yKnee - 0.1 && p.y < yPelvis - 0.06)
      col = rainbow((p.y + p.z * 0.8) * 28.0);
    if (uFlags2.z > 1.5 && p.y < yKnee + 0.08 + 0.1 * abs(sin(around * 3.0 + p.y * 9.0))) col = vec3(0.03);
  }
  // ginocchiere
  if (abs(p.y - yKnee) < 0.07 && ax < xThigh + 0.12) { col = uPads; cloth = 1.0; }
  // stivali alti fino a metà polpaccio, suola scura, lacci chiari davanti
  if (p.y < yFoot - 0.05) { col = uBoots * 0.35; cloth = 1.0; }
  else if (p.y < bootTop && ax < xThigh + 0.12) {
    col = uBoots; cloth = 1.0;
    if (p.z > 0.0 && abs(ax - xThigh) < 0.012 && p.y > yFoot) col = mix(uBoots, vec3(1.0), 0.6);
  }
  // slip o pantaloncini con elastico e banda laterale
  float legCut = yPelvis - 0.13 - uFlags2.w * 0.2 + 0.06 * smoothstep(xThigh - 0.06, xThigh + 0.12, ax);
  if (leg && p.y > legCut) {
    col = uTrunks; cloth = 1.0;
    if (p.y > yWaist - 0.025 || (uFlags2.y < 0.5 && p.y < legCut + 0.018)) col = uTrim;
    if (uFlags2.y < 0.5 && ax > xThigh + 0.06 && ax < xThigh + 0.1) col = uTrim;
  }
  // canotta (giromanica largo, scollo) o body da lotta (spalline strette, disegno a V)
  float kind = uFlags2.x;
  vec3 hp = vec3(ax, p.y, p.z) - uHand;
  float along = dot(hp, uArmDir);
  if (kind > 2.5) {
    // completo: giacca con maniche fino ai polsi, camicia e cravatta (uTop giacca, uTop2 camicia, uTop3 cravatta)
    // pantaloni lunghi fino alle scarpe nere lucide
    if (leg) {
      col = uTrunks; cloth = 1.0;
      if (p.y < yFoot + 0.025) { col = vec3(0.004); shoe = 1.0; }
    }
    bool sleeve = ax > uArmX * 0.75 && along < -0.02;
    float hem = yPelvis - 0.2;                                  // la giacca copre i fianchi
    bool torso = ax < max(uArmX * 1.05, xThigh + 0.2) && p.y > hem && p.y < yNeck - 0.01 && (ax < uArmX * 1.05 || p.y < yPelvis);
    if (sleeve || torso) {
      col = uTop; cloth = 1.0;
      float sy = uChest - 0.17;
      float vee = 0.02 + (p.y - sy) * 0.4;                     // scollo della giacca, ampio
      if (torso && p.z > 0.0 && p.y > sy && ax < vee) {
        col = uTop2;
        if (p.y > yNeck - 0.045 && ax > 0.03) col = mix(uTop2, vec3(0.6), 0.25);   // colletto della camicia
        float tie = 0.012 + (yNeck - p.y) * 0.08;
        if (ax < tie || (p.y > yNeck - 0.04 && ax < 0.02)) {
          col = uTop3;                                           // cravatta (nodo in alto)
          if (uExtra.y > 0.5 && mod(floor((p.y - p.x) * 60.0), 2.0) < 1.0) col = mix(uTop3, vec3(0.9, 0.85, 0.75), 0.55);
        }
      } else if (torso && p.z > 0.0 && p.y > sy - 0.03 && ax < vee + 0.045) {
        col = uTop * 0.55;                   // risvolti in raso nero, bordino chiaro più scuri, ben visibili
      }
      if (torso && p.z > 0.0 && p.y < sy && ax < 0.004) col = uTop * 0.4;   // chiusura della giacca
      // sotto l'ultimo bottone la giacca si apre: si vedono i pantaloni
      if (torso && p.z > 0.0 && p.y < yPelvis - 0.04 && ax < (yPelvis - 0.04 - p.y) * 0.9) col = uTrunks;
      if (torso && p.y < hem + 0.012) col = uTop * 0.45;                    // orlo della giacca
      if (torso && p.z > 0.02 && abs(ax - 0.09) < 0.035 && abs(p.y - (yPelvis + 0.03)) < 0.006) col = uTop * 0.45;   // tasche
      if (torso && p.z > 0.0 && p.y < sy && p.y > yPelvis - 0.02 && abs(ax - 0.008) < 0.007 && mod(p.y - sy, 0.07) < 0.014) col = vec3(0.04);   // bottoni
      if (torso && p.x > 0.05 && p.x < 0.1 && p.z > 0.0 && p.y > uChest - 0.02 && p.y < uChest + 0.01) col = uTop2;   // fazzoletto nel taschino
      if (sleeve && along > -0.05) col = uTop2;   // polsini della camicia
    }
  } else if (kind > 0.5) {
    float armhole = kind < 1.5
      ? mix(uArmX * 0.95, uArmX * 0.6, smoothstep(uChest - 0.06, yNeck - 0.02, p.y))
      : mix(uArmX * 0.8, uArmX * 0.42, smoothstep(uChest - 0.1, yNeck - 0.03, p.y));
    float bottom = kind < 1.5 ? yWaist - 0.08 : legCut;
    float vTop = yNeck - (kind < 1.5 ? 0.12 : 0.16);
    bool neckline = p.y > vTop && ax < 0.06 + (p.y - vTop) * (p.z > 0.0 ? 0.9 : 0.5);
    if (p.y >= bottom && p.y < yNeck - 0.03 && ax < armhole && !neckline) {
      cloth = 1.0;
      if (kind < 1.5) {
        col = uTop;
        bool edge = armhole - ax < 0.014 || (p.y > vTop - 0.015 && ax < 0.075 + (p.y - vTop) * 0.9);
        if (edge || p.y < bottom + 0.02) col = uTop2;
      } else {
        float vee = yWaist + 0.16 - ax * 0.9;
        col = p.y > vee ? uTop : (p.y > vee - 0.1 ? uTop2 : uTop3);
      }
    }
  }
  // fascia nera a metà del braccio sinistro
  if (uArmbandOn > 0.5 && p.x > 0.0 && along < -(uExtra.z + 0.06) && along > -(uExtra.z + 0.11) && length(hp - uArmDir * along) < 0.09) { col = uArmband; cloth = 1.0; }
  // nastro ai polsi
  if (uFlags.z > 0.5 && along < -0.005 && along > -0.12 && length(hp - uArmDir * along) < 0.075) { col = uTape; cloth = 1.0; }
  // arbitro: camicia a righe verticali con maniche corte e colletto nero, cintura, pantaloni lunghi e scarpe nere
  if (uFlags.y > 0.5) {
    if (leg) {
      col = vec3(0.035); cloth = 1.0;
      if (p.y < yFoot + 0.01) col = vec3(0.012);                           // scarpe
      if (ax > xThigh + 0.07 && ax < xThigh + 0.085 && p.y > yFoot + 0.05) col = vec3(0.06);   // cucitura laterale
    }
    bool shirtArm = ax > uArmX * 0.72 && along < -(uExtra.z + 0.11) && p.y > yWaist;
    bool shirtBody = ax < uArmX * 1.02 && p.y > yWaist - 0.035 && p.y < yNeck - 0.005;
    if (shirtArm || shirtBody) {
      cloth = 1.0;
      float stripes = shirtArm ? dot(vec3(ax, p.y, p.z), cross(uArmDir, vec3(0.0, 0.0, 1.0))) : p.x;
      col = mod(floor((stripes + 0.5) * 34.0), 2.0) < 1.0 ? vec3(0.92) : vec3(0.025);
      if (shirtArm && along > -(uExtra.z + 0.125)) col = vec3(0.025);                     // bordo delle maniche
      if (shirtBody && p.y > yNeck - 0.04 && ax < 0.085) col = vec3(0.025);              // colletto
      if (shirtBody && p.z > 0.0 && ax < 0.006 && p.y > yWaist) col = vec3(0.02);        // abbottonatura
    }
    if (leg && p.y > yWaist - 0.035 && p.y < yWaist - 0.005) {
      col = vec3(0.015); cloth = 1.0;                                                  // cintura con fibbia
      if (p.z > 0.0 && ax < 0.022) col = vec3(0.55, 0.55, 0.58);
    }
  }
  // barba: mento, guance e baffi; più è lunga più scende sul collo
  if (uFlags.w > 0.0) {
    float lo = eyeY - 0.125 - uFlags.w * 0.05;   // dal mento in giù solo se lunga
    bool front = p.z > uHeadZ + 0.015 || (p.z > uHeadZ - 0.03 && ax > 0.055);
    float wide = uFlags.w < 0.05 ? 0.03 : 0.085;   // lunghezza ~0: pizzetto e baffetti
    if (p.y > lo && p.y < eyeY - 0.045 && front && ax < wide) {
      col = uBeard * (0.85 + 0.3 * fract(sin(dot(p.xy * 400.0, vec2(12.9, 78.2))) * 43758.5)); cloth = 1.0;
    }
  }
  ${faceGLSL('uFlags.x < 0.5')}
  // occhiali: montatura sottile attorno agli occhi e ponte sul naso
  if (uExtra.x > 0.5 && p.z > uHeadZ) {
    float d = length(vec2((ax - uY2.z) / 0.036, (p.y - eyeY - 0.003) / 0.026));
    if ((d > 0.92 && d < 1.2) || (ax < uY2.z - 0.03 && abs(p.y - eyeY - 0.008) < 0.004)) { col = vec3(0.12); cloth = 1.0; }
  }
  // cappellino (con la visiera all'indietro)
  if (uCapOn > 0.5 && p.y > eyeY + 0.045 + (p.z < uHeadZ ? -0.02 : 0.0)) { col = uCap; cloth = 1.0; }
  // maschera da luchador: fori degli occhi bordati e banda centrale
  if (uFlags.x > 0.5 && p.y > yNeck + 0.015) {
    col = uMask; cloth = 1.0;
    float ex = abs(ax - uY2.z), ey = abs(p.y - eyeY);
    if (uFaceOn < 0.5 && p.z > 0.0 && ex < 0.034 && ey < 0.026) col = uMaskTrim;
    if (uFaceOn < 0.5 && ax < 0.012 && p.y > eyeY + 0.03) col = uMaskTrim;
  }
  ${faceGLSL('uFlags.x > 0.5')}
  if (uShell > 0.5) {
    // strato della giacca: solo tronco e maniche (aperto davanti sulla camicia), sotto i pantaloni larghi
    float hem = yPelvis - 0.06;
    bool sleeve = ax > uArmX * 0.75 && along < -0.035 && p.y > yWaist;
    bool torso = ax < uArmX * 1.05 && p.y > hem && p.y < yNeck - 0.01;
    if (!(sleeve || torso)) {
      if (!(leg && p.y > yFoot + 0.01)) discard;
      col = uTrunks; cloth = 1.0;                                                  // pantaloni
      if (p.z > 0.0 && abs(abs(p.x) - xThigh) < 0.003 && p.y < hem) col = uTrunks * 0.6;   // piega davanti
      if (!gl_FrontFacing) col = uTrunks * 0.3;
      diffuseColor.rgb = col;
    } else {
    float sy = uChest - 0.17;
    float vee = 0.02 + (p.y - sy) * 0.4;
    if (torso && p.z > 0.0 && p.y > sy && ax < vee) discard;
    col = uTop; cloth = 1.0;
    if (torso && p.z > 0.0 && p.y > sy - 0.035 && ax < vee + 0.045) col = p.y > sy + 0.01 && ax > vee + 0.038 ? vec3(0.35) : vec3(0.025);   // risvolti in raso nero, bordino chiaro
    if (torso && p.z > 0.0 && p.y < sy && p.y > yPelvis && abs(ax - 0.012) < 0.008 && mod(p.y - sy, 0.08) < 0.016) col = vec3(0.03);   // bottoni
    if (torso && p.z > 0.02 && abs(ax - 0.1) < 0.04 && abs(p.y - (yPelvis + 0.03)) < 0.006) col = uTop * 0.45;   // tasche
    if (torso && p.x > 0.06 && p.x < 0.11 && p.z > 0.0 && p.y > uChest - 0.015 && p.y < uChest + 0.012) col = uTop2;   // fazzoletto
    if (torso && p.y < hem + 0.01) col = uTop * 0.5;                                                          // orlo
    if (!gl_FrontFacing) col = uTop * 0.3;                                                                    // fodera
    }
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.45, cloth), 1.0, shoe);');
  };
  if (shell) m.side = THREE.DoubleSide;
  m.customProgramCacheKey = () => (shell ? 'bwt-gear-shell' : 'bwt-gear');
  return m;
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpT = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion(), tmpQ4 = new THREE.Quaternion();

export class WrestlerRig {
  constructor(models, look) {
    const inst = SkeletonUtils.clone(models.scene);
    const s = look.height / models.height;
    inst.scale.setScalar(s);
    inst.position.y = -models.groundOffset * s;
    this.hipH = models.metric.hip * s;
    this.thighLen = models.metric.thigh * s;
    this.calfLen = models.metric.calf * s;

    inst.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (o.name === models.body.name) o.material = gearMaterial(o.material, models, look);
      else if (/hair/i.test(o.material?.name || '')) {
        // sopracciglia: nascoste sotto la maschera
        if (look.mask || look.face) o.visible = false;
        o.material = o.material.clone();
        o.material.color = new THREE.Color(look.hair ?? '#222222');
      } else if (look.mask && /eye/i.test(o.material?.name || '')) {
        o.visible = false;   // occhi del modello: sotto la maschera si vede il disegno della foto
      }
    });

    // completo: giacca vera sopra il corpo (stessa geometria e stesso scheletro, un po' più larga)
    if (look.top?.kind === 'completo') {
      let body = null;
      inst.traverse((o) => { if (o.name === models.body.name) body = o; });
      const jacket = new THREE.SkinnedMesh(body.geometry, gearMaterial(body.material, models, look, true));
      jacket.bind(body.skeleton, body.bindMatrix);
      jacket.castShadow = true;
      jacket.frustumCulled = false;
      body.parent.add(jacket);
    }

    this.bulk = look.slim || look.lean ? SLIM_BONES : BULK_BONES;
    this.bones = {};
    inst.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });

    if (look.hairStyle != null && !look.mask) {
      const hair = new THREE.Group();
      for (const i of look.hairStyle === 'corti' ? [0] : [0, 1]) hair.add(SkeletonUtils.clone(models.hairs[i]));
      hair.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone();
        o.material.color = new THREE.Color(look.hair);
        if (/long/i.test(o.name)) trimBangs(o.material, look.hairStyle === 'medi' ? 1.62 : 0);
      });
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(models.headRestInv);
      holder.add(hair);
      this.bones.Head?.add(holder);
    }

    if (look.hat) {
      // il cappello segue l'osso della testa: costruito negli assi della testa a riposo, scalato sul modello
      const R = models.hatRef;
      const left = new THREE.Vector3().crossVectors(R.up, R.fwd).normalize();
      const frame = new THREE.Group();
      frame.matrixAutoUpdate = false;
      frame.matrix.makeBasis(left, R.up, R.fwd).scale(new THREE.Vector3(R.k, R.k, R.k)).setPosition(R.pos);
      frame.matrix.premultiply(models.headRestInv);
      frame.add(cowboyHat(look.hat));
      this.bones.Head?.add(frame);
    }

    if (look.antennae || look.headband) {
      const R = models.hatRef;
      const left = new THREE.Vector3().crossVectors(R.up, R.fwd).normalize();
      const frame = new THREE.Group();
      frame.matrixAutoUpdate = false;
      frame.matrix.makeBasis(left, R.up, R.fwd).scale(new THREE.Vector3(R.k, R.k, R.k)).setPosition(R.pos);
      frame.matrix.premultiply(models.headRestInv);
      if (look.antennae) frame.add(antennae(look.antennae));
      if (look.headband) frame.add(headband(look.headband));
      this.bones.Head?.add(frame);
    }

    this.root = inst;
    this.mixer = new THREE.AnimationMixer(inst);
    this.actions = {};
    for (const [k, clip] of Object.entries(models.clips)) {
      const a = this.actions[k] = this.mixer.clipAction(clip);
      // mosse singole (pugno, caduta…): una volta sola, poi restano sull'ultimo fotogramma
      if (clip.userData?.once) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    }
    // strato "gambe piegate" (posizione di guardia): l'accovacciata mescolata sopra le altre
    this.crouch = this.actions.defense;
    this.crouchW = 0;
    this.crouch.play();
    this.crouch.setEffectiveWeight(0);
    this.current = null;
    this.play('idle', 0);
    this.dirs = {};
    this.weights = Object.fromEntries(ORDER.map((c) => [c, 0]));
  }

  has(key) { return !!this.actions[key]; }

  // from: secondo da cui partire; restart: riparte anche se è già l'animazione in corso
  play(key, fade = 0.2, from = 0, restart = false) {
    const next = this.actions[key];
    if (!next || (key === this.current && !restart)) return;
    next.reset().play();
    next.time = from;
    if (this.current && this.current !== key) this.actions[this.current].crossFadeTo(next, fade, false);
    this.current = key;
  }

  // pose: { anim, speed, crouch, aims: { catena: [x,y,z] } }; k = fattore di avvicinamento di questo fotogramma
  update(dt, pose, k) {
    this.play(pose.anim ?? 'idle', pose.fade ?? 0.2, pose.from ?? 0, pose.restart);
    this.actions[this.current].timeScale = pose.speed ?? 1;
    this.crouchW += ((pose.crouch ?? 0) - this.crouchW) * Math.min(1, dt * 8);
    this.crouch.setEffectiveWeight(this.crouchW);
    this.mixer.update(dt);
    for (const [n, f] of Object.entries(this.bulk)) this.bones[n]?.scale.setScalar(f);
    this.root.updateMatrixWorld(true);

    const aims = pose.aims || {};
    for (const c of ORDER) {
      const t = aims[c];
      this.weights[c] += ((t ? 1 : 0) - this.weights[c]) * k;
      if (t) {
        tmpT.set(t[0], t[1], t[2]).normalize();
        const d = this.dirs[c] || (this.dirs[c] = tmpT.clone());
        d.lerp(tmpT, k);
        if (d.lengthSq() < 1e-4) d.copy(tmpT);
        d.normalize();
      }
      if (this.weights[c] > 0.01 && this.dirs[c]) this.aim(CHAINS[c][0], CHAINS[c][1], this.dirs[c], this.weights[c]);
    }
  }

  // ruota un osso perché punti verso una direzione (nel sistema del lottatore)
  aim(boneName, childName, dir, w) {
    const b = this.bones[boneName], ch = this.bones[childName];
    if (!b || !ch) return;
    const from = ch.getWorldPosition(tmpV).sub(b.getWorldPosition(tmpV2)).normalize();
    const to = tmpT.copy(dir).applyQuaternion(this.root.parent.getWorldQuaternion(tmpQ3));
    const delta = tmpQ.setFromUnitVectors(from, to);
    const world = b.getWorldQuaternion(tmpQ2).premultiply(delta);
    const local = b.parent.getWorldQuaternion(tmpQ4).invert().multiply(world);
    b.quaternion.slerp(local, w);
    b.updateMatrixWorld(true);
  }
}
