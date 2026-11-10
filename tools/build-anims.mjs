// Converte le animazioni CC0 di Quaternius (Universal Animation Library, versione Unreal Engine)
// sullo scheletro dei Universal Base Characters e le salva compatte in JSON.
// Uso: node tools/build-anims.mjs <AL_Standard.fbx> <Personaggio.gltf> <uscita.json>
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const [fbxPath, gltfPath, outPath] = process.argv.slice(2);
const CLIPS = {
  idle: 'Idle_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  defense: 'Crouch_Idle_Loop',
  defenseMove: 'Crouch_Fwd_Loop',
  jump: 'Jump_Start',
};
const SKIP = /^(root|.*(index|middle|ring|pinky)_0\d|.*_end_.*|.*_leaf_.*)$/; // dita: posa di riposo

const buf = fs.readFileSync(fbxPath);
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const src = {};
fbx.traverse((o) => { if (o.isBone) src[o.name] = { q: o.quaternion.clone(), p: o.position.clone() }; });
const g = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
const dst = {};
for (const n of g.nodes) {
  dst[n.name] = { q: new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), p: new THREE.Vector3(...(n.translation || [0, 0, 0])) };
}
const ratio = dst.pelvis.p.length() / src.pelvis.p.length();
const r4 = (v) => Math.round(v * 1e4) / 1e4;

const out = [];
for (const [key, name] of Object.entries(CLIPS)) {
  const clip = fbx.animations.find((a) => a.name.endsWith(`|${name}`) || a.name === name);
  if (!clip) { console.warn('manca', name); continue; }
  const tracks = [];
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (SKIP.test(bone) || !dst[bone] || !src[bone]) continue;
    if (prop === 'quaternion') {
      // q_dest = q_riposo_dest * inv(q_riposo_src) * q_anim
      const corr = dst[bone].q.clone().multiply(src[bone].q.clone().invert());
      const v = t.values.slice();
      const q = new THREE.Quaternion();
      for (let i = 0; i < v.length; i += 4) {
        q.fromArray(v, i).premultiply(corr).normalize().toArray(v, i);
      }
      tracks.push({ name: `${bone}.quaternion`, type: 'quaternion', times: Array.from(t.times, r4), values: Array.from(v, r4) });
    } else if (prop === 'position' && bone === 'pelvis') {
      const v = t.values.slice();
      for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) v[i + k] = dst.pelvis.p.getComponent(k) + (v[i + k] - src.pelvis.p.getComponent(k)) * ratio;
      }
      tracks.push({ name: 'pelvis.position', type: 'vector', times: Array.from(t.times, r4), values: Array.from(v, r4) });
    }
  }
  out.push({ name: key, duration: r4(clip.duration), tracks });
  console.log(key.padEnd(12), name.padEnd(18), `${clip.duration.toFixed(2)}s`, tracks.length, 'tracce');
}
fs.writeFileSync(outPath, JSON.stringify({ source: 'Quaternius Universal Animation Library (CC0)', clips: out }));
console.log('scritto', outPath, (fs.statSync(outPath).size / 1024).toFixed(0), 'KB');
