// Converte le animazioni Mixamo (FBX "Without Skin") sullo scheletro dei Universal Base Characters di Quaternius
// e le salva compatte in public/models/mixamo/mixamo.json.
// Il trasferimento avviene nello spazio del mondo: per ogni osso si prende la rotazione rispetto alla posa di riposo
// di Mixamo (a T) e la si applica all'osso corrispondente, dopo averlo allineato alla stessa direzione
// (così la posa ad A del nostro modello non sposta le braccia).
// Uso: node tools/build-mixamo.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public/models/mixamo');
const GLTF = path.join(ROOT, 'public/models/quaternius/ragazzo.gltf');
const FPS = 30;

// nome nel gioco: parole da cercare nel nome del file (sia il nome consigliato sia quello originale di Mixamo)
const CLIPS = {
  guardia: ['guardia', 'fighting idle', 'boxing idle'],
  camminata: ['camminata', 'walking', 'walk'],
  corsa: ['corsa', 'running', 'run'],
  pugno: ['pugno', 'punching', 'punch', 'cross'],
  calcio: ['calcio', 'mma kick', 'kick'],
  colpito: ['colpito', 'reaction', 'hit', 'head hit'],
  caduta: ['caduta', 'knocked out', 'falling', 'fall'],
  rialzata: ['rialzata', 'getting up', 'get up', 'stand up'],
  esultanza: ['esultanza', 'victory', 'fist pump', 'cheer'],
  parata: ['parata', 'block'],
  stordito: ['stordito', 'dizzy', 'stunned'],
  provocazione: ['provocazione', 'taunt'],
  pestone: ['pestone', 'stomp'],
  presa: ['presa', 'grab'],
  a_terra: ['a_terra', 'lying', 'laying'],
  presentatore: ['presentatore', 'talking', 'pointing'],
  applauso: ['applauso', 'clapping'],
};
// clip che restano ferme sull'ultimo fotogramma o che si ripetono
const LOOP = new Set(['guardia', 'camminata', 'corsa', 'esultanza', 'stordito', 'a_terra', 'presentatore', 'applauso']);

// osso Mixamo -> osso Quaternius, con il figlio che dà la direzione dell'osso
const MAP = {
  Hips: ['pelvis'], Spine: ['spine_01', 'spine_02'], Spine1: ['spine_02', 'spine_03'], Spine2: ['spine_03', 'neck_01'],
  Neck: ['neck_01', 'Head'], Head: ['Head'],
  LeftShoulder: ['clavicle_l', 'upperarm_l'], LeftArm: ['upperarm_l', 'lowerarm_l'], LeftForeArm: ['lowerarm_l', 'hand_l'], LeftHand: ['hand_l', 'middle_01_l'],
  RightShoulder: ['clavicle_r', 'upperarm_r'], RightArm: ['upperarm_r', 'lowerarm_r'], RightForeArm: ['lowerarm_r', 'hand_r'], RightHand: ['hand_r', 'middle_01_r'],
  LeftUpLeg: ['thigh_l', 'calf_l'], LeftLeg: ['calf_l', 'foot_l'], LeftFoot: ['foot_l', 'ball_l'], LeftToeBase: ['ball_l'],
  RightUpLeg: ['thigh_r', 'calf_r'], RightLeg: ['calf_r', 'foot_r'], RightFoot: ['foot_r', 'ball_r'], RightToeBase: ['ball_r'],
};
const SRC_CHILD = {
  Hips: null, Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: null,
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: null,
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase', RightToeBase: null,
};
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// --- scheletro di destinazione, ricostruito dai nodi del glTF ---
function loadDest() {
  const g = JSON.parse(fs.readFileSync(GLTF, 'utf8'));
  const objs = g.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  g.nodes.forEach((n, i) => (n.children || []).forEach((c) => objs[i].add(objs[c])));
  const root = new THREE.Object3D();
  for (const i of g.scenes[g.scene || 0].nodes) root.add(objs[i]);
  root.updateMatrixWorld(true);
  return { root, bone: (n) => root.getObjectByName(n) };
}

// assi del personaggio nel mondo (su, sinistra) per mettere d'accordo i due scheletri
function frame(get, hips, head, thighL, thighR) {
  const p = (n) => get(n).getWorldPosition(new THREE.Vector3());
  const up = p(head).sub(p(hips)).normalize();
  const left = p(thighL).sub(p(thighR));
  left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up);
  return new THREE.Matrix4().makeBasis(left, up, fwd);
}

function findFile(words, files) {
  for (const w of words) {
    const f = files.find((x) => x.toLowerCase().replace(/\.fbx$/, '').replace(/[_-]/g, ' ') === w.replace(/_/g, ' '));
    if (f) return f;
  }
  for (const w of words) {
    const f = files.find((x) => x.toLowerCase().includes(w.replace(/_/g, ' ')));
    if (f) return f;
  }
  return null;
}

const dest = loadDest();
const D = (n) => dest.bone(n);
const dstFrame = frame(D, 'pelvis', 'Head', 'thigh_l', 'thigh_r');
const dstRestW = {};
for (const [, [b]] of Object.entries(MAP)) dstRestW[b] = D(b).getWorldQuaternion(new THREE.Quaternion());
const dstHipH = D('pelvis').getWorldPosition(new THREE.Vector3()).sub(D('ball_l').getWorldPosition(new THREE.Vector3())).dot(new THREE.Vector3().setFromMatrixColumn(dstFrame, 1));
const dstPelvisRest = D('pelvis').getWorldPosition(new THREE.Vector3());

const files = fs.readdirSync(DIR).filter((f) => /\.fbx$/i.test(f));
const used = new Set();
const out = [];
for (const [key, words] of Object.entries(CLIPS)) {
  const file = findFile(words, files.filter((f) => !used.has(f)));
  if (!file) continue;
  used.add(file);
  const buf = fs.readFileSync(path.join(DIR, file));
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = fbx.animations[0];
  if (!clip) { console.warn('nessuna animazione in', file); continue; }
  // le ossa si chiamano "mixamorig:Hips", "mixamorigHips" o "mixamorig6Hips" a seconda dell'esportazione
  const byName = {};
  fbx.traverse((o) => { if (o.isBone) byName[o.name.replace(/^mixamorig\d*:?/, '')] = o; });
  const S = (n) => byName[n];
  if (!S('Hips')) { console.warn('scheletro Mixamo non trovato in', file); continue; }
  fbx.updateMatrixWorld(true);

  // posa di riposo della sorgente (a T) e rotazione che porta il mondo Mixamo nel nostro
  const srcFrame = frame(S, 'Hips', 'Head', 'LeftUpLeg', 'RightUpLeg');
  const G = new THREE.Quaternion().setFromRotationMatrix(dstFrame.clone().multiply(srcFrame.clone().transpose()));
  const Ginv = G.clone().invert();
  const srcRestW = {}, align = {};
  for (const [s, [d, dChild]] of Object.entries(MAP)) {
    srcRestW[s] = S(s).getWorldQuaternion(new THREE.Quaternion());
    align[d] = new THREE.Quaternion();
    const sc = SRC_CHILD[s] && S(SRC_CHILD[s]);
    if (dChild && sc) {
      const sDir = sc.getWorldPosition(new THREE.Vector3()).sub(S(s).getWorldPosition(new THREE.Vector3())).applyQuaternion(G).normalize();
      const dDir = D(dChild).getWorldPosition(new THREE.Vector3()).sub(D(d).getWorldPosition(new THREE.Vector3())).normalize();
      align[d].setFromUnitVectors(dDir, sDir);
    }
  }
  const srcHipsRest = S('Hips').getWorldPosition(new THREE.Vector3());
  const srcUp = new THREE.Vector3().setFromMatrixColumn(srcFrame, 1);
  const srcFoot = S('LeftToeBase').getWorldPosition(new THREE.Vector3());
  const ratio = dstHipH / srcHipsRest.clone().sub(srcFoot).dot(srcUp);

  const mixer = new THREE.AnimationMixer(fbx);
  mixer.clipAction(clip).play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = [], qv = {}, pv = [];
  for (const [, [d]] of Object.entries(MAP)) qv[d] = [];
  const wq = {}, q = new THREE.Quaternion(), delta = new THREE.Quaternion(), pw = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / FPS);
    mixer.setTime(t);
    fbx.updateMatrixWorld(true);
    times.push(r4(t));
    // rotazioni del mondo di destinazione, dai genitori ai figli
    for (const [s, [d]] of Object.entries(MAP)) {
      delta.copy(S(s).getWorldQuaternion(q)).multiply(srcRestW[s].clone().invert());   // rispetto al riposo, nel mondo Mixamo
      delta.premultiply(G).multiply(Ginv);                                              // nel nostro mondo
      wq[d] = delta.clone().multiply(align[d]).multiply(dstRestW[d]);
      // locale = inverso(mondo del genitore) * mondo; il genitore non mappato resta a riposo
      const parent = D(d).parent;
      if (wq[parent.name]) pw.copy(wq[parent.name]);
      else parent.getWorldQuaternion(pw);
      const local = pw.clone().invert().multiply(wq[d]).normalize();
      qv[d].push(...local.toArray().map(r4));
    }
    // bacino: solo il movimento verticale (le animazioni restano sul posto), scalato sull'altezza del nostro modello
    const hp = S('Hips').getWorldPosition(new THREE.Vector3()).sub(srcHipsRest).applyQuaternion(G).multiplyScalar(ratio);
    const up = new THREE.Vector3().setFromMatrixColumn(dstFrame, 1);
    const wpos = dstPelvisRest.clone().addScaledVector(up, hp.dot(up));
    const local = D('pelvis').parent.worldToLocal(wpos);
    pv.push(...local.toArray().map(r4));
  }
  const tracks = Object.entries(qv).map(([d, values]) => ({ name: `${d}.quaternion`, type: 'quaternion', times, values }));
  tracks.push({ name: 'pelvis.position', type: 'vector', times, values: pv });
  out.push({ name: key, duration: r4(clip.duration), loop: LOOP.has(key), tracks });
  console.log(key.padEnd(13), file.padEnd(22), `${clip.duration.toFixed(2)}s`);
}
for (const f of files) if (!used.has(f)) console.warn('non usato:', f);
const outPath = path.join(DIR, 'mixamo.json');
fs.writeFileSync(outPath, JSON.stringify({ source: 'Mixamo (Adobe)', clips: out }));
console.log('scritto', outPath, (fs.statSync(outPath).size / 1024).toFixed(0), 'KB');
