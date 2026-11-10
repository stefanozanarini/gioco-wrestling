// Avversario controllato dal computer: produce gli stessi comandi del giocatore.
import { blankIntent } from '../input/controls.js';

export class AI {
  constructor(self, opp, level = 0.55) {
    Object.assign(this, { self, opp, level });
    this.cool = 1.2;
    this.blockT = 0;
    this.backT = 0;
    this.holdT = 0;
    this.strafe = 1;
    this.strafeT = 0;
    this.runMode = false;
    this.lastOppState = '';
  }

  intent(dt) {
    const I = blankIntent();
    const w = this.self, o = this.opp, L = this.level;
    this.cool -= dt;
    const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist, uz = dz / dist;

    if (w.state === 'down') { I.mash = Math.random() < dt * 5 * L; return I; }
    if (w.state === 'hold') {
      this.holdT += dt;
      if (this.holdT > 0.45 + Math.random() * 0.4) {
        this.holdT = 0;
        const r = Math.random();
        if (w.special >= 100) I.finisher = true;
        else if (r < 0.36) I.punch = true;
        else if (r < 0.72) I.kick = true;
        else I.grab = true;
      }
      return I;
    }
    this.holdT = 0;
    if (!w.canAct) return I;

    // reazione ai colpi in arrivo: a volte para
    if (o.state !== this.lastOppState) {
      this.lastOppState = o.state;
      if ((o.state === 'punch' || o.state === 'kick') && dist < 1.4 && Math.random() < L * 0.45) this.blockT = 0.45;
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
        const r = Math.random(), pin = o.hp < 55 ? 0.6 : 0.2;
        if (r < pin) I.pin = true;
        else if (r < pin + 0.35) I.kick = true;
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
