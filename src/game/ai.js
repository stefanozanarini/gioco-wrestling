// Lottatori controllati dal computer (avversari e compagni nel 2 contro 2): producono gli stessi comandi del giocatore.
import { blankIntent } from '../input/controls.js';
import { RING_HALF, OUT_MIN } from './wrestler.js';

export class AI {
  constructor(self, match, level = 0.55) {
    Object.assign(this, { self, match, level });
    this.cool = 1.2;
    this.blockT = 0;
    this.backT = 0;
    this.holdT = 0;
    this.strafe = 1;
    this.strafeT = 0;
    this.runMode = false;
    this.lastOppState = '';
    this.follow = false;     // segue l'avversario fuori dal ring
    this.followT = 0;
    this.wantChair = false;
  }

  // cammina verso un punto (I.mx/mz), restituisce la distanza
  goTo(I, x, z, run = false) {
    const w = this.self, dx = x - w.pos.x, dz = z - w.pos.z, d = Math.hypot(dx, dz) || 0.001;
    I.mx = dx / d; I.mz = dz / d; I.run = run && d > 2.5;
    return d;
  }

  // cambia zona: verso le corde più vicine all'obiettivo (o al bordo del ring) e poi spinge
  crossTo(I, goal) {
    const w = this.self;
    I.cross = true;
    if (!w.out) {
      const axis = Math.abs(goal.x) > Math.abs(goal.z) ? 'x' : 'z', other = axis === 'x' ? 'z' : 'x';
      const s = Math.sign(goal[axis]) || 1;
      const p = { [axis]: s * RING_HALF, [other]: Math.max(-3, Math.min(3, goal[other])) };
      if (this.goTo(I, p.x, p.z) < 0.25) { I.mx = axis === 'x' ? s : 0; I.mz = axis === 'z' ? s : 0; }
      return;
    }
    const axis = Math.abs(w.pos.x) > Math.abs(w.pos.z) ? 'x' : 'z', other = axis === 'x' ? 'z' : 'x';
    const s = Math.sign(w.pos[axis]) || 1;
    const p = { [axis]: s * (OUT_MIN + 0.05), [other]: Math.max(-3.3, Math.min(3.3, w.pos[other])) };
    if (this.goTo(I, p.x, p.z) < 0.3) { I.mx = axis === 'x' ? -s : 0; I.mz = axis === 'z' ? -s : 0; }
  }

  intent(dt) {
    const I = blankIntent();
    I.cross = false;   // esce o rientra dal ring solo quando lo decide (crossTo), non spingendo per caso contro le corde
    const w = this.self, m = this.match, L = this.level;
    const props = m.props;
    this.cool -= dt;

    if (w.state === 'down') { I.mash = Math.random() < dt * 5 * L; return I; }
    if (w.state === 'hold') {
      this.holdT += dt;
      if (this.holdT > 0.45 + Math.random() * 0.4) {
        this.holdT = 0;
        const r = Math.random();
        // vicino a un tavolo: lo schianto è assicurato
        if (w.out && props.tableNear(w.pos, 2.3)) { if (w.special >= 100) I.finisher = true; else I.kick = true; }
        else if (w.special >= 100) I.finisher = true;
        else if (r < 0.36) I.punch = true;
        else if (r < 0.72) I.kick = true;
        else I.grab = true;
      }
      return I;
    }
    this.holdT = 0;
    if (!w.canAct) return I;

    // il conteggio fuori dal ring: si rientra in tempo
    if (w.out && w.outT > 6.5 + (1 - L) * 2) { if (w.carry) I.grab = true; else this.crossTo(I, { x: 0, z: 0 }); return I; }

    // un compagno viene schienato: si corre a interrompere il conteggio
    const P = m.pin;
    if (P && P.v.team === w.team && P.v !== w) {
      if (w.out) { this.crossTo(I, P.a.pos); return I; }
      const d = this.goTo(I, P.a.pos.x, P.a.pos.z, true);
      if (d < 0.9 && this.cool <= 0) { I.mx = I.mz = 0; I.kick = true; this.cool = 0.4; }
      return I;
    }

    const o = m.target(w);
    if (!o) return I;
    const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist, uz = dz / dist;

    // avversario nell'altra zona (sul ring / fuori)
    if (o.out !== w.out && o.state !== 'ropes' && o.state !== 'flying') {
      this.followT -= dt;
      if (this.followT <= 0) {
        this.followT = 2 + Math.random() * 2;
        this.follow = w.out || Math.random() < 0.25 + L * 0.5;
        this.wantChair = Math.random() < 0.55;
      }
      if (w.carry && !w.out) { I.grab = true; return I; }
      if (this.follow) this.crossTo(I, o.pos);
      else if (!w.out) this.goTo(I, o.pos.x * 0.4, o.pos.z * 0.4);
      return I;
    }

    // fuori dal ring: a volte prende una sedia
    if (w.out && !w.carry && this.wantChair && o.state !== 'down') {
      const chair = props.chairNear(w.pos, 4);
      if (chair) {
        const d = this.goTo(I, chair.mesh.position.x, chair.mesh.position.z);
        if (d < 0.75) { I.mx = I.mz = 0; I.grab = true; this.wantChair = false; }
        return I;
      }
    }
    if (w.carry) {
      if (dist > 1.1) { I.mx = ux; I.mz = uz; return I; }
      if (this.cool <= 0) { I.punch = true; this.cool = 0.8; }
      return I;
    }

    // reazione ai colpi in arrivo: a volte para
    if (o.state !== this.lastOppState) {
      this.lastOppState = o.state;
      if ((o.state === 'punch' || o.state === 'kick' || o.state === 'swing') && dist < 1.5 && Math.random() < L * 0.45) this.blockT = 0.45;
    }
    if (this.blockT > 0) { this.blockT -= dt; I.block = true; return I; }
    if (this.backT > 0) { this.backT -= dt; I.mx = -ux; I.mz = -uz; return I; }

    // avversario lanciato contro le corde: aspetta il rimbalzo e colpisce
    if (o.state === 'whipped' || o.state === 'rebound') {
      if (o.state === 'rebound' && dist < 1.3 && this.cool <= 0) {
        if (Math.random() < 0.6) I.punch = true; else I.kick = true;
        this.cool = 0.6;
      }
      return I;
    }

    if (o.state === 'down' || o.state === 'pinned') {
      if (dist > 0.95) { I.mx = ux; I.mz = uz; I.run = dist > 3; return I; }
      if (this.cool <= 0) {
        this.cool = 0.5 + Math.random() * 0.5;
        const r = Math.random(), pin = o.out || m.pin ? 0 : o.hp < 55 ? 0.6 : 0.2;
        if (r < pin) I.pin = true;
        else if (r < pin + 0.35) I.kick = true;
        else if (o.out && r < 0.7) { this.wantChair = true; this.backT = 0.4; }   // fuori: lascia che lo conti l'arbitro
        else if (w.special < 100) I.taunt = true;
      }
      return I;
    }
    if (o.state === 'getup') {
      if (dist < 1.2) { I.mx = -ux; I.mz = -uz; }
      return I;
    }

    if (dist > 0.85) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 1 + Math.random() * 1.5;
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        this.runMode = dist > 3 && Math.random() < 0.6;
      }
      I.mx = ux - uz * 0.35 * this.strafe;
      I.mz = uz + ux * 0.35 * this.strafe;
      I.run = this.runMode;
      // clothesline in corsa
      if (w.state === 'run' && dist < 1.6 && this.cool <= 0) { I.punch = true; this.cool = 1; this.runMode = false; }
      return I;
    }

    if (this.cool <= 0) {
      this.cool = 1.0 - L * 0.6 + Math.random() * 0.5;
      const r = Math.random();
      if (r < 0.34) I.punch = true;
      else if (r < 0.52) I.kick = true;
      else if (r < 0.8) I.grab = true;
      else if (r < 0.9) this.blockT = 0.5;
      else this.backT = 0.5;
    }
    return I;
  }
}
