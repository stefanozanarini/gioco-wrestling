// Lottatore: posizione, stato e pose. Le misure sono in metri.
import * as THREE from 'three';

export const MAT_Y = 1.2;        // altezza del tappeto del ring
export const RING_HALF = 3.45;   // metà lato utile del ring (dentro le corde)
export const WALK_SPEED = 1.9;
export const RUN_SPEED = 4.6;
export const APRON = 4.1;        // bordo del ring (oltre c'è il pavimento)
export const OUT_MIN = 4.4;      // fuori dal ring si resta almeno a questa distanza dal centro (lungo x o z)
export const OUT_MAX = 7.2;      // transenne

// altezza del pavimento in un punto: tappeto del ring o pavimento dell'arena
export const groundAt = (x, z) => (Math.abs(x) < APRON && Math.abs(z) < APRON ? MAT_Y : 0);

const FREE_STATES = new Set(['idle', 'walk', 'run', 'block', 'carry']);
const UNHITTABLE = new Set(['down', 'pinned', 'pinning', 'getup', 'thrown', 'lifting', 'held', 'hold', 'celebrate', 'refCount', 'ropes', 'flying']);
const FAST_STATES = new Set(['punch', 'kick', 'stomp', 'clothesline', 'block', 'grab', 'swing']);

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// braccia e gambe simmetriche: la direzione è quella del lato sinistro, la destra è specchiata
const mir = (v) => [-v[0], v[1], v[2]];
const ARMS = (ua, fa) => ({ ual: ua, fal: fa, uar: mir(ua), far: mir(fa) });
const LEGS = (th, sh) => ({ thl: th, shl: sh, thr: mir(th), shr: mir(sh) });
const GUARD = ARMS([0.45, -0.5, 0.7], [-0.3, 0.75, 0.6]);

export class Wrestler {
  constructor(rig, info) {
    this.rig = rig;
    this.info = info;
    this.name = info.name;
    this.isRef = !!info.isRef;
    this.isStaff = !!info.isStaff;
    // stile di gioco dal peso: i pesi massimi sono lenti ma potenti
    const kg = info.kg ?? 90;
    this.speedK = THREE.MathUtils.clamp(1.12 - (kg - 80) / 260, 0.86, 1.14);
    this.powerK = THREE.MathUtils.clamp(0.88 + (kg - 80) / 220, 0.85, 1.2);
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();          // perno ai fianchi: inclinazione del corpo intero (a terra, sollevato)
    const offset = new THREE.Group();
    offset.position.y = -rig.hipH;
    this.root.add(this.tilt);
    this.tilt.add(offset);
    offset.add(rig.root);

    this.HIP = rig.hipH;
    this.LIFT_DOWN = -rig.hipH + 0.13;
    this.LIFT_KNEEL = rig.thighLen + 0.06 - rig.hipH;
    this.LIFT_CROUCH = rig.calfLen + 0.15 - rig.hipH;

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.tiltX = 0;
    this.lift = 0;
    this.forced = null;     // inclinazione/sollevamento imposti da una mossa
    this.slap = 0;          // arbitro: mano che batte sul tappeto
    this.clock = Math.random() * 10;
    this.reset(0, 0, 0);
  }

  reset(x, z, facing) {
    this.pos.set(x, MAT_Y, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.hp = 100;
    this.special = 0;
    this.downTimer = 0;
    this.combo = 0;
    this.lastHit = -9;
    this.lastBig = false;
    this.attackSide = 1;
    this.ropeCd = 0;
    this.forced = null;
    this.tiltX = 0;
    this.lift = 0;
    this.out = false;       // fuori dal ring
    this.outT = 0;          // da quanto è fuori (conteggio dell'arbitro)
    this.pushT = 0;         // da quanto spinge contro le corde o il bordo del ring
    this.carry = null;      // sedia in mano
    this.held = null;       // avversario tenuto in presa
    this.transit = null;    // passaggio tra le corde
    this.setState('idle');
  }

  setState(s, dur = 0) {
    // knockAnim: è caduto con l'animazione Mixamo (resta a terra in quella posa e si rialza con la sua animazione)
    this.getupAnim = s === 'getup' && !!this.knockAnim;
    if (s !== 'down' && s !== 'pinned') this.knockAnim = false;
    this.fresh = true;
    this.serial = (this.serial || 0) + 1;   // cambia a ogni nuovo stato, anche se uguale al precedente (multiplayer)
    this.state = s;
    this.stateTime = 0;
    this.stateDur = dur;
    this.hitDone = false;
  }

  ensure(s) { if (this.state !== s) this.setState(s); }

  get forward() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get side() { return new THREE.Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing)); }
  get canAct() { return FREE_STATES.has(this.state); }
  get isDown() { return this.state === 'down' || this.state === 'pinned'; }
  get hittable() { return !UNHITTABLE.has(this.state); }

  turnTo(angle, dt, rate = 10) {
    this.facing += wrapAngle(angle - this.facing) * Math.min(1, rate * dt);
  }

  faceNow(p) { this.facing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }

  targetPose() {
    const t = this.stateTime, c = this.clock;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    const P = { anim: 'idle', speed: 1, crouch: 0.28, aims: { ...GUARD }, tiltX: 0, lift: 0, rate: 12 };
    const kneel = () => {
      P.lift = this.LIFT_KNEEL; P.crouch = 0;
      Object.assign(P.aims, { thl: [0.12, -1, 0.05], shl: [0.02, -0.1, -1], thr: [-0.15, -0.1, 1], shr: [-0.03, -1, 0.05] });
    };

    if (this.isStaff) {
      // braccia lungo i fianchi; il presentatore tiene il microfono alla bocca, il dirigente esulta
      P.aims = {}; P.crouch = 0;
      if (this.state === 'walk') {
        if (this.rig.has('camminata')) { P.anim = 'camminata'; P.speed = THREE.MathUtils.clamp(spd / 1.5, 0.7, 1.4); }
        else { P.anim = 'run'; P.speed = THREE.MathUtils.clamp(spd / 3, 0.55, 1.2); }
        return P;
      }
      if (this.state === 'announce') {
        P.aims.uar = [-0.35, -0.25, 0.9]; P.aims.far = [0.3, 0.9, 0.3];
        P.aims.ual = [0.75, 0.3 + 0.25 * Math.sin(c * 3), 0.6]; P.aims.fal = [0.5, 0.6, 0.6];
      } else if (this.state === 'cheer') {
        const pump = Math.sin(t * 10);
        Object.assign(P.aims, ARMS([0.5, 0.85, 0.15], [0.25 + 0.1 * pump, 0.95, 0.1]));
      } else {
        Object.assign(P.aims, ARMS([0.2, -0.9, 0.35], [-0.6, 0.05, 0.8]));   // braccia conserte
      }
      return P;
    }
    if (this.isRef) {
      P.aims = {}; P.crouch = 0;
      if (this.state === 'walk' || this.state === 'run') { P.anim = this.state === 'run' ? 'sprint' : 'run'; P.speed = THREE.MathUtils.clamp(spd / 3, 0.6, 1.4); }
      if (this.state === 'refCount') {
        kneel();
        P.aims.spine = [0, 0.6, 0.8];
        P.aims.ual = [0.5, -0.7, 0.5]; P.aims.fal = [0.2, -0.8, 0.55];
        const s = this.slap;
        P.aims.uar = [-0.25, 0.8 - 1.55 * s, 0.5]; P.aims.far = [-0.1, 0.9 - 1.75 * s, 0.4];
        P.rate = 18;
      }
      return P;
    }

    if (this.mixamoPose(P, t, spd)) return P;

    switch (this.state) {
      case 'idle':
        P.aims.spine = [0, 1, 0.12 + Math.sin(c * 2.6) * 0.04];
        break;
      case 'walk':
        P.anim = 'run'; P.speed = THREE.MathUtils.clamp(spd / 3.2, 0.5, 1.4); P.crouch = 0.18;
        break;
      case 'run': case 'whipped': case 'rebound':
        P.anim = 'sprint'; P.speed = THREE.MathUtils.clamp(spd / 5, 0.8, 1.4); P.crouch = 0; P.aims = {};
        break;
      case 'punch': {
        const [u, f] = this.attackSide > 0 ? ['ual', 'fal'] : ['uar', 'far'];
        const m = this.attackSide > 0 ? (v) => v : mir;
        if (t < 0.09) { P.aims[u] = m([0.4, -0.55, -0.45]); P.aims[f] = m([0.05, 0.55, 0.85]); }
        else if (t < 0.24) { P.aims[u] = m([0.06, 0.12, 1]); P.aims[f] = m([0.02, 0.1, 1]); P.aims.spine = [0, 0.94, 0.34]; }
        P.rate = 26;
        break;
      }
      case 'kick':
        P.crouch = 0; P.rate = 24;
        Object.assign(P.aims, ARMS([0.85, -0.3, 0.3], [0.8, -0.1, 0.5]));
        if (t < 0.16) { P.aims.thr = [-0.08, -0.2, 0.98]; P.aims.shr = [0, -0.95, -0.3]; }
        else if (t < 0.38) { P.aims.thr = [-0.05, 0.15, 1]; P.aims.shr = [-0.03, 0.2, 1]; P.aims.spine = [0, 0.95, -0.3]; }
        break;
      case 'stomp':
        P.crouch = 0; P.rate = 24;
        if (t < 0.18) { P.aims.thr = [-0.08, -0.1, 1]; P.aims.shr = [0, -1, 0.1]; }
        else if (t < 0.4) { P.aims.thr = [-0.05, -0.85, 0.5]; P.aims.shr = [0, -1, 0]; P.aims.spine = [0, 0.9, 0.4]; }
        break;
      case 'clothesline':
        P.anim = 'sprint'; P.crouch = 0; P.rate = 22;
        P.aims = { ual: [1, 0.08, 0.2], fal: [1, 0.1, 0.25], spine: [0, 0.95, 0.3] };
        break;
      case 'carry':
        // sedia sollevata sopra la testa con due mani
        if (spd > 0.3) {
          P.anim = this.rig.has('camminata') ? 'camminata' : 'run';
          P.speed = THREE.MathUtils.clamp(spd / (P.anim === 'run' ? 3.2 : 1.5), 0.6, 1.5);
        }
        P.crouch = 0;
        P.aims = { ...ARMS([0.45, 0.85, 0.2], [-0.45, 0.85, 0.25]) };
        break;
      case 'swing': {
        const p = t / (this.stateDur || 1);
        P.crouch = 0.15; P.rate = 22;
        P.aims = p < 0.32 ? { ...ARMS([0.35, 0.85, -0.35], [-0.35, 0.75, -0.5]), spine: [0, 0.97, -0.25] }
          : { ...ARMS([0.25, 0.05, 1], [-0.25, -0.25, 0.95]), spine: [0, 0.8, 0.6] };
        break;
      }
      case 'ropes':
        // passa chinato tra la seconda e la terza corda
        P.crouch = 0; P.rate = 10;
        P.tiltX = -0.55; P.lift = this.LIFT_CROUCH * 0.7;
        P.aims = { ...ARMS([0.4, -0.3, 0.85], [0.2, -0.5, 0.85]), spine: [0, 0.6, 0.8] };
        break;
      case 'block':
        P.aims = { ...ARMS([0.3, -0.25, 0.92], [-0.55, 0.82, 0.15]), spine: [0, 0.95, 0.25] }; P.crouch = 0.38;
        break;
      case 'grab':
        P.aims = { ...ARMS([0.32, -0.2, 0.93], [-0.3, 0.05, 0.95]), spine: [0, 0.9, 0.42] }; P.crouch = 0.35;
        break;
      case 'hold':
        P.aims = { ...ARMS([0.3, -0.35, 0.88], [-0.45, 0.1, 0.88]), spine: [0, 0.88, 0.48] }; P.crouch = 0.4;
        break;
      case 'held':
        P.aims = { ...ARMS([0.25, -0.85, 0.45], [0.05, -0.95, 0.3]), spine: [0, 0.35, 0.94] }; P.crouch = 0.3;
        break;
      case 'stunned':
        P.aims = { ...ARMS([0.6, -0.65, -0.4], [0.55, -0.75, -0.1]), spine: [0, 0.94, -0.33] }; P.crouch = 0;
        break;
      case 'lifting':
        P.aims = { ...ARMS([0.28, 0.95, 0.12], [0, 1, 0.05]), spine: [0, 0.98, -0.15] }; P.crouch = 0.22;
        break;
      case 'thrown': case 'flying': {
        const w = Math.sin(c * 13);
        P.aims = { ...ARMS([0.95, 0.3 + 0.3 * w, 0], [0.9, 0.4, 0.1]), ...LEGS([0.15, -0.9, 0.35 + 0.25 * w], [0.1, -0.95, 0.1]) };
        P.crouch = 0;
        break;
      }
      case 'down': case 'pinned': {
        P.tiltX = -Math.PI / 2; P.lift = this.LIFT_DOWN; P.crouch = 0; P.rate = 7;
        const kickLegs = this.state === 'pinned' ? Math.max(0, Math.sin(c * 10)) * 0.4 : 0;
        P.aims = {
          ...ARMS([0.95, 0.1, -0.25], [0.95, 0.2, 0.1]),
          spine: [0, 1, 0.04 + Math.sin(c * 2) * 0.03],
          thl: [0.15, -0.75, 0.6 + kickLegs], shl: [0.08, -0.85, -0.5],
          thr: [-0.1, -1, 0.02], shr: [-0.08, -1, -0.02],
        };
        break;
      }
      case 'getup':
        P.crouch = 0; P.rate = 8;
        if (t < this.stateDur * 0.5) {
          P.tiltX = -0.45; P.lift = this.LIFT_CROUCH;
          P.aims = { ...ARMS([0.5, -0.85, 0.2], [0.3, -0.9, 0.3]), ...LEGS([0.2, -0.3, 0.93], [0.05, -0.97, -0.25]), spine: [0, 0.7, 0.7] };
        }
        break;
      case 'taunt': case 'celebrate': {
        const pump = Math.sin(t * 9);
        P.aims = { ...ARMS([0.65, 0.75, 0.1], [0.35 + 0.1 * pump, 0.93, 0.05]), spine: [0, 0.97, -0.22] };
        P.crouch = 0.1 + 0.12 * Math.max(0, pump);
        break;
      }
      case 'pinning':
        kneel();
        Object.assign(P.aims, ARMS([0.2, -0.6, 0.78], [0.1, -0.75, 0.65]));
        P.aims.spine = [0, 0.45, 0.9]; P.rate = 9;
        break;
    }
    if (FAST_STATES.has(this.state) && P.rate < 20) P.rate = 22;
    return P;
  }

  update(dt) {
    this.clock += dt;
    this.stateTime += dt;
    this.ropeCd = Math.max(0, this.ropeCd - dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const P = this.targetPose();
    const k = 1 - Math.exp(-P.rate * dt);
    this.tiltX += (P.tiltX - this.tiltX) * k;
    this.lift += (P.lift - this.lift) * k;
    if (this.forced) {
      if (this.forced.tiltX != null) this.tiltX = this.forced.tiltX;
      if (this.forced.lift != null) this.lift = this.forced.lift;
    }
    this.root.rotation.y = this.facing;
    this.tilt.position.y = this.HIP + this.lift;
    this.tilt.rotation.x = this.tiltX;
    this.root.updateMatrixWorld(true);
    this.rig.update(dt, P, k);
    this.fresh = false;
  }

  // animazioni Mixamo, se presenti (public/models/mixamo): sostituiscono le pose fatte a mano.
  // Restituisce true se la posa è completa; per la camminata cambia solo le gambe e lascia le braccia in guardia.
  mixamoPose(P, t, spd) {
    const has = (k) => this.rig.has(k);
    const clip = (anim, speed = 1, extra = {}) => {
      Object.assign(P, { anim, speed, aims: {}, crouch: 0, tiltX: 0, lift: 0, fade: 0.12, restart: this.fresh }, extra);
      return true;
    };
    switch (this.state) {
      // guardia: corpo e gambe dall'animazione, braccia in guardia fatte a mano (sul nostro modello i pugni finirebbero sul viso)
      case 'idle': return has('guardia') && clip('guardia', 1, { fade: 0.25, restart: false, aims: { ...GUARD } });
      case 'walk':
        if (has('camminata')) {
          P.anim = 'camminata'; P.speed = THREE.MathUtils.clamp(spd / 1.5, 0.6, 1.6); P.crouch = 0; P.fade = 0.2;
          P.aims = { ...GUARD };
        }
        return false;
      case 'run': case 'whipped': case 'rebound':
        return has('corsa') && clip('corsa', THREE.MathUtils.clamp(spd / 4, 0.8, 1.5), { fade: 0.15, restart: false });
      case 'punch': return has('pugno') && clip('pugno', 2.2, { fade: 0.06 });
      case 'kick': return has('calcio') && clip('calcio', 2.6, { fade: 0.06 });
      case 'stunned': return has('colpito') && clip('colpito', 1.6, { fade: 0.06 });
      case 'down': case 'pinned':
        return this.knockAnim && has('caduta') && clip('caduta', 1.3, { restart: false, fade: 0.1 });
      case 'getup':
        return this.getupAnim && has('rialzata') && clip('rialzata', 2.5, { from: 3.2, fade: 0.35 });
      case 'taunt': case 'celebrate':
        return has('esultanza') && clip('esultanza', 1, { fade: 0.25, restart: false });
    }
    return false;
  }

  // porta subito inclinazione e sollevamento alla posa dello stato attuale
  snapBody() {
    const P = this.targetPose();
    this.tiltX = P.tiltX;
    this.lift = P.lift;
  }
}
