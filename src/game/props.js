// Oggetti a bordo ring: sedie pieghevoli (si prendono, si portano e si spaccano sull'avversario)
// e tavoli (si rompono quando qualcuno ci viene schiantato sopra). I pezzi rotti restano a terra fino al prossimo incontro.
import * as THREE from 'three';
import { groundAt } from './wrestler.js';

// posizioni a bordo ring, quasi tutte dal lato della telecamera (x, z, rotazione)
const CHAIRS = [[0.9, 5.5, 0.3], [2.4, 6.2, -0.5], [-5.9, 2.2, 1.4], [-6.1, -1.9, 1.8], [6.3, 3.6, -1.2]];
const TABLES = [[-2.4, 5.95, 0], [6.05, -1.3, Math.PI / 2]];
const TABLE_W = 1.8, TABLE_D = 0.76, TABLE_H = 0.76;
const GRAVITY = 9.8;

const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.75, roughness: 0.35 });
const seatMat = new THREE.MeshStandardMaterial({ color: '#2a2c33', metalness: 0.5, roughness: 0.45 });
const wood = new THREE.MeshStandardMaterial({ color: '#8a5d36', roughness: 0.75 });
const woodDark = new THREE.MeshStandardMaterial({ color: '#5e3d22', roughness: 0.8 });

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// sedia pieghevole di metallo, con l'origine al centro (si ruota attorno al centro quando la si brandisce)
function chairMesh() {
  const g = new THREE.Group();
  const y0 = -0.45;
  g.add(box(0.42, 0.035, 0.4, seatMat, 0, y0 + 0.46, 0));
  g.add(box(0.42, 0.3, 0.03, seatMat, 0, y0 + 0.8, -0.2));
  for (const sx of [-1, 1]) {
    g.add(box(0.025, 0.95, 0.025, steel, sx * 0.2, y0 + 0.475, -0.21));   // montanti posteriori fino allo schienale
    const front = box(0.025, 0.48, 0.025, steel, sx * 0.2, y0 + 0.24, 0.17);
    g.add(front);
  }
  g.add(box(0.42, 0.02, 0.02, steel, 0, y0 + 0.08, 0.17));
  return g;
}

// tavolo pieghevole di legno
function tableMesh() {
  const g = new THREE.Group();
  g.add(box(TABLE_W, 0.05, TABLE_D, wood, 0, TABLE_H, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, TABLE_H, 0.04, steel, sx * (TABLE_W / 2 - 0.12), TABLE_H / 2, sz * (TABLE_D / 2 - 0.08)));
  return g;
}

export class Props {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.debris = [];
    for (const [x, z, r] of CHAIRS) this.add('chair', chairMesh(), x, z, r);
    for (const [x, z, r] of TABLES) this.add('table', tableMesh(), x, z, r);
    this.reset();
  }

  add(kind, mesh, x, z, rot) {
    const it = { id: this.items.length, kind, mesh, home: [x, z, rot], state: 'free', holder: null };
    this.scene.add(mesh);
    this.items.push(it);
  }

  reset() {
    for (const it of this.items) {
      if (it.holder) it.holder.carry = null;
      it.holder = null;
      it.state = 'free';
      this.scene.add(it.mesh);
      it.mesh.visible = true;
      it.mesh.rotation.set(0, it.home[2], 0);
      this.place(it, it.home[0], it.home[1], it.home[2]);
    }
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
  }

  // appoggia l'oggetto a terra (o sul tappeto del ring)
  place(it, x, z, rot) {
    it.mesh.position.set(x, groundAt(x, z) + (it.kind === 'chair' ? 0.45 : 0), z);
    it.mesh.rotation.set(0, rot, 0);
  }

  // sedia libera più vicina entro r, nella stessa zona (dentro o fuori dal ring)
  chairNear(pos, r) {
    let best = null, bd = r;
    for (const it of this.items) {
      if (it.kind !== 'chair' || it.state !== 'free') continue;
      const p = it.mesh.position;
      if (Math.abs(groundAt(p.x, p.z) - pos.y) > 0.5) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // tavolo intatto sotto il punto (pos), con un po' di margine
  tableAt(pos, margin = 0.35) {
    return this.items.find((it) => it.kind === 'table' && it.state === 'free' && this.inTable(it, pos, margin)) || null;
  }

  inTable(it, pos, margin) {
    const p = it.mesh.position, r = it.home[2];
    const dx = pos.x - p.x, dz = pos.z - p.z;
    const u = dx * Math.cos(r) - dz * Math.sin(r), v = dx * Math.sin(r) + dz * Math.cos(r);
    return Math.abs(u) < TABLE_W / 2 + margin && Math.abs(v) < TABLE_D / 2 + margin;
  }

  tableNear(pos, r) {
    return this.items.find((it) => it.kind === 'table' && it.state === 'free' && it.mesh.position.distanceTo(pos) < r) || null;
  }

  // i tavoli interi sono solidi: chi cammina fuori dal ring li aggira
  collide(w) {
    if (!w.out) return;
    for (const it of this.items) {
      if (it.kind !== 'table' || it.state !== 'free') continue;
      const p = it.mesh.position, r = it.home[2], c = Math.cos(r), s = Math.sin(r);
      const dx = w.pos.x - p.x, dz = w.pos.z - p.z;
      let u = dx * c - dz * s, v = dx * s + dz * c;
      const hu = TABLE_W / 2 + 0.25, hv = TABLE_D / 2 + 0.25;
      if (Math.abs(u) >= hu || Math.abs(v) >= hv) continue;
      if (hu - Math.abs(u) < hv - Math.abs(v)) u = Math.sign(u || 1) * hu; else v = Math.sign(v || 1) * hv;
      w.pos.x = p.x + u * c + v * s;
      w.pos.z = p.z - u * s + v * c;
    }
  }

  pickUp(w, it) {
    it.state = 'held';
    it.holder = w;
    w.carry = it;
    w.root.add(it.mesh);
    this.holdPose(it);
  }

  // la sedia cade davanti a chi la teneva
  drop(w) {
    const it = w.carry;
    if (!it) return;
    w.carry = null;
    it.holder = null;
    it.state = 'free';
    this.scene.add(it.mesh);
    const f = w.forward;
    this.place(it, w.pos.x + f.x * 0.5, w.pos.z + f.z * 0.5, w.facing + 0.4);
  }

  // l'oggetto va in pezzi: frammenti che volano nella direzione del colpo (dx, dz)
  smash(id, dx = 0, dz = 0) {
    const it = this.items[id];
    if (!it || it.state === 'broken') return;
    const wp = it.mesh.getWorldPosition(new THREE.Vector3());
    if (it.holder) it.holder.carry = null;
    it.holder = null;
    it.state = 'broken';
    this.scene.add(it.mesh);
    it.mesh.visible = false;
    const piece = (w, h, d, mat, x, y, z, spread) => {
      const m = box(w, h, d, mat);
      m.position.set(wp.x + x, wp.y + y, wp.z + z);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(m);
      this.debris.push({
        mesh: m,
        vel: new THREE.Vector3(dx * 2.5 + (Math.random() - 0.5) * spread, 1.5 + Math.random() * 2.5, dz * 2.5 + (Math.random() - 0.5) * spread),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14),
        half: h / 2,
      });
    };
    if (it.kind === 'chair') {
      piece(0.42, 0.035, 0.4, seatMat, 0, 0, 0, 4);
      piece(0.42, 0.3, 0.03, seatMat, 0, 0.3, 0, 4);
      for (let k = 0; k < 4; k++) piece(0.025, 0.3 + Math.random() * 0.4, 0.025, steel, (Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4, 5);
    } else {
      // tavolo spezzato in due, gambe e schegge
      for (const s of [-1, 1]) piece(TABLE_W * 0.45, 0.05, TABLE_D * 0.9, wood, s * 0.45, TABLE_H, 0, 1.5);
      for (let k = 0; k < 4; k++) piece(0.04, TABLE_H, 0.04, steel, (Math.random() - 0.5) * 1.4, TABLE_H / 2, (Math.random() - 0.5) * 0.6, 2);
      for (let k = 0; k < 14; k++) piece(0.06 + Math.random() * 0.25, 0.03, 0.04 + Math.random() * 0.06, k % 3 ? wood : woodDark, (Math.random() - 0.5) * 1.6, TABLE_H, (Math.random() - 0.5) * 0.6, 6);
    }
  }

  // sedia in mano: sopra la testa; durante il colpo cala in avanti
  holdPose(it) {
    const w = it.holder, h = w.info.height ?? 1.8, m = it.mesh;
    let k = 0, up = 0;
    if (w.state === 'swing') {
      const p = w.stateTime / (w.stateDur || 1);
      up = THREE.MathUtils.smoothstep(p, 0, 0.3);
      k = THREE.MathUtils.smoothstep(p, 0.32, 0.5);
    }
    m.position.set(0, h * (1.02 + 0.1 * up) - h * 0.32 * k, 0.08 - 0.15 * up + 0.75 * k);
    m.rotation.set(-0.35 - 0.9 * up + 2.4 * k, 0, 0);
  }

  update(dt) {
    for (const it of this.items) if (it.holder) this.holdPose(it);
    for (const d of this.debris) {
      if (d.rest) continue;
      const p = d.mesh.position;
      d.vel.y -= GRAVITY * dt;
      p.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const g = groundAt(p.x, p.z) + d.half;
      if (p.y < g) {
        p.y = g;
        if (Math.abs(d.vel.y) < 0.8) {
          d.rest = true;
          d.mesh.rotation.x = Math.round(d.mesh.rotation.x / Math.PI) * Math.PI;
          d.mesh.rotation.z = Math.round(d.mesh.rotation.z / Math.PI) * Math.PI;
        }
        d.vel.y *= -0.3; d.vel.x *= 0.5; d.vel.z *= 0.5; d.spin.multiplyScalar(0.5);
      }
    }
  }

  // ---------- multiplayer ----------
  // stato di ogni oggetto: [0 libero / 1 in mano / 2 rotto, chi lo tiene (indice nella lista), x, z, rotazione]
  snapshot(fighters) {
    const r2 = (v) => Math.round(v * 100) / 100;
    return this.items.map((it) => {
      const p = it.mesh.position;
      return it.state === 'held' ? [1, fighters.indexOf(it.holder)]
        : it.state === 'broken' ? [2] : [0, -1, r2(p.x), r2(p.z), r2(it.mesh.rotation.y)];
    });
  }

  apply(list, fighters) {
    if (!list) return;
    list.forEach(([st, who, x, z, rot], i) => {
      const it = this.items[i];
      if (!it) return;
      if (st === 2) { this.smash(i); return; }
      if (it.state === 'broken') {   // nuovo incontro: gli oggetti tornano al loro posto
        this.debris.forEach((d) => this.scene.remove(d.mesh));
        this.debris.length = 0;
        it.mesh.visible = true;
        it.state = 'free';
      }
      if (st === 1) {
        const w = fighters[who];
        if (w && it.holder !== w) {
          if (it.holder) it.holder.carry = null;
          this.pickUp(w, it);
        }
        return;
      }
      if (it.holder) { it.holder.carry = null; it.holder = null; this.scene.add(it.mesh); }
      it.state = 'free';
      this.place(it, x, z, rot);
    });
  }
}
