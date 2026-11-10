// Regole del match (1 contro 1, vittoria per schienamento) e risoluzione di colpi, prese e proiezioni.
import * as THREE from 'three';
import { RING_HALF, RUN_SPEED, WALK_SPEED, MAT_Y } from './wrestler.js';

const STRIKES = {
  punch:       { dur: 0.42, from: 0.09, to: 0.2, range: 0.95, minDot: 0.55, dmg: 4, stun: 0.35, heavy: false },
  kick:        { dur: 0.62, from: 0.18, to: 0.32, range: 1.15, minDot: 0.6, dmg: 7, stun: 0.55, heavy: true },
  stomp:       { dur: 0.6, from: 0.2, to: 0.32, range: 1.25, minDot: 0.2, dmg: 5, low: true, heavy: true },
  clothesline: { dur: 0.7, from: 0.06, to: 0.4, range: 1.0, minDot: 0.45, dmg: 10, knock: true, unblockable: true, heavy: true, name: 'CLOTHESLINE!' },
};

// cosa dice Max Malpensa salendo sul ring a fine incontro
const CLEANUP_LINES = [
  'Bel match, ragazzi! Adesso però pulite tutto!',
  'Applausi per entrambi! E ora scope e stracci: pulite tutto il ring!',
  'Spettacolo! Ma prima di andare a casa, qui si pulisce tutto!',
];

const ease = (t) => t * t * (3 - 2 * t);

// sollevamento e schianto davanti all'attaccante (body slam, powerbomb)
function liftAndSlam(height, up, hold, reach) {
  return (m, p) => {
    const { a, v, A, f } = m;
    v.facing = a.facing + Math.PI;
    let h, drop = 0;
    if (p < up) h = ease(p / up);
    else if (p < up + hold) h = 1;
    else { const q = (p - up - hold) / (1 - up - hold); h = 1 - q * q; drop = q; }
    const d = 0.55 + (reach - 0.55) * ease(p);
    v.pos.set(A.x + f.x * d, MAT_Y, A.z + f.z * d);
    v.forced = { tiltX: (-Math.PI / 2) * Math.min(1, p / up), lift: height * h + v.LIFT_DOWN * drop };
  };
}

// suplex: la vittima passa sopra la testa e cade dietro, l'attaccante cade all'indietro con lei
function suplex(m, p) {
  const { a, v, A, f } = m;
  v.facing = a.facing + Math.PI;
  const e = ease(p);
  const d = 0.55 + (-1.65 - 0.55) * e;
  v.pos.set(A.x + f.x * d, MAT_Y, A.z + f.z * d);
  v.forced = { tiltX: 1.5 * Math.PI * e, lift: v.LIFT_DOWN * e + 1.25 * Math.sin(Math.PI * p) };
  const q = ease(Math.max(0, (p - 0.3) / 0.7));
  a.forced = { tiltX: (-Math.PI / 2) * q, lift: a.LIFT_DOWN * q };
}

const THROWS = {
  suplex: { name: 'SUPLEX!', dur: 1.25, dmg: 13, animate: suplex },
  slam: { name: 'BODY SLAM!', dur: 1.05, dmg: 11, animate: liftAndSlam(1.0, 0.55, 0, 0.95) },
  powerbomb: { name: 'POWERBOMB!!!', dur: 1.75, dmg: 30, special: true, animate: liftAndSlam(1.35, 0.38, 0.27, 0.9) },
};

const ATTACKING = new Set(['punch', 'kick', 'clothesline']);
const SOLID_SKIP = new Set(['held', 'hold', 'thrown', 'lifting', 'pinning', 'pinned']);

export class Match {
  // humans: lottatori guidati da persone (si liberano dallo schienamento premendo i tasti);
  // la barra per liberarsi si vede solo per p1, il giocatore di questo schermo
  constructor({ p1, p2, ref, staff, hud, sfx, fx, humans = [p1] }) {
    Object.assign(this, { p1, p2, ref, staff, hud, sfx, fx });
    this.humans = new Set(humans);
    this.reset();
  }

  reset() {
    this.p1.reset(-1.8, 0.9, Math.PI / 2);
    this.p2.reset(1.8, -0.9, -Math.PI / 2);
    this.ref.reset(0, -2.6, 0);
    // il presentatore annuncia l'incontro al centro del ring, il dirigente guarda da bordo ring
    const { speaker, boss } = this.staff;
    speaker.reset(0, 0.4, 0);
    speaker.setState('announce');
    boss.reset(4.9, 5.1, 0);
    boss.pos.y = 0;
    boss.faceNow({ x: 0, z: 0 });
    this.cheerCd = 0;
    this.introStep = 0;
    this.phase = 'intro';
    this.time = 0;
    this.overT = 0;
    this.hype = 0.3;
    this.move = null;
    this.pin = null;
    this.winner = null;
    this.outro = null;
    this.hud.announce(`${speaker.name} presenta…`, 'blue');
  }

  updateStaff(dt) {
    const { speaker, boss } = this.staff;
    if (this.phase === 'intro' && this.introStep === 0 && this.time > 1.5) {
      this.introStep = 1;
      this.hud.announce(`${this.p1.name}  vs  ${this.p2.name}`);
      this.sfx.crowd(0.7);
    }
    // il dirigente esulta per le mosse spettacolari; a fine incontro sale sul ring
    this.cheerCd -= dt;
    if (this.outro) this.updateOutro(dt);
    else {
      if (boss.state === 'cheer' && boss.stateTime > 1.6) boss.setState('idle');
      if (this.hype > 0.8 && this.cheerCd <= 0) {
        boss.setState('cheer');
        this.cheerCd = 4;
      }
      boss.turnTo(Math.atan2(-boss.pos.x, -boss.pos.z), dt, 3);
    }
    for (const w of [speaker, boss]) w.update(dt);
  }

  // Max Malpensa esulta, entra tra le corde, va al centro e chiede di pulire tutto
  updateOutro(dt) {
    const b = this.staff.boss, o = this.outro;
    o.t += dt;
    const next = () => { o.step++; o.t = 0; };
    const goTo = (x, z, speed) => {
      const dx = x - b.pos.x, dz = z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { b.vel.set(0, 0, 0); return true; }
      b.vel.set((dx / d) * speed, 0, (dz / d) * speed);
      b.turnTo(Math.atan2(dx, dz), dt, 6);
      b.ensure('walk');
      return false;
    };
    switch (o.step) {
      case 0:
        if (o.t > 2) { b.setState('idle'); next(); }
        break;
      case 1:   // lungo il ring fino al lato destro
        if (goTo(4.9, 2.2, 1.9)) next();
        break;
      case 2: { // sale sul bordo e passa tra le corde
        const f = Math.min(1, o.t / 0.9);
        b.pos.y = MAT_Y * Math.min(1, f * 1.6);
        b.pos.x = 4.9 - 1.6 * THREE.MathUtils.smoothstep(f, 0.3, 1);
        b.ensure('walk');
        b.turnTo(-Math.PI / 2, dt, 6);
        if (f >= 1) next();
        break;
      }
      case 3:
        if (goTo(o.spot.x, o.spot.z, 1.6)) { b.setState('announce'); next(); }
        break;
      case 4:
        b.turnTo(0, dt, 4);
        if (o.t > 4.2) next();
        break;
      default:
        b.turnTo(0, dt, 4);
        o.done = true;
    }
  }

  update(dt, i1, i2) {
    this.time += dt;
    this.hype = Math.max(0.1, this.hype - dt * 0.12);
    if (this.phase === 'intro' && this.time > 3.4) {
      // il presentatore scende dal ring e resta a bordo ring
      const { speaker } = this.staff;
      speaker.reset(-4.9, 5.1, 0);
      speaker.pos.y = 0;
      speaker.faceNow({ x: 0, z: 0 });
      this.phase = 'fight';
      this.sfx.bell(1);
      this.hud.announce('FIGHT!');
    }
    if (this.phase === 'over') this.overT += dt;
    if (this.move) this.updateMove(dt);
    if (this.pin) this.updatePin(dt, this.pin.v === this.p1 ? i1 : i2);
    if (this.phase === 'fight') {
      this.handle(this.p1, this.p2, i1, dt);
      this.handle(this.p2, this.p1, i2, dt);
    }
    this.collide();
    this.updateRef(dt);
    this.updateStaff(dt);
    for (const w of [this.p1, this.p2, this.ref]) {
      w.update(dt);
      this.keepInRing(w);
    }
    this.hud.setBars(this.p1, this.p2);
  }

  handle(w, o, I, dt) {
    switch (w.state) {
      case 'idle': case 'walk': case 'run': case 'block':
        this.handleFree(w, o, I, dt); break;
      case 'punch': case 'kick': case 'stomp': case 'clothesline':
        this.handleStrike(w, o, dt); break;
      case 'grab': this.handleGrab(w, o); break;
      case 'hold': this.handleHold(w, o, I); break;
      case 'whipped': case 'rebound': this.handleWhip(w, o); break;
      case 'stunned':
        w.vel.multiplyScalar(Math.exp(-6 * dt));
        if (w.stateTime >= w.stateDur) w.setState('idle');
        break;
      case 'down':
        w.vel.set(0, 0, 0);
        if (I.mash) w.downTimer -= 0.12;
        w.downTimer -= dt;
        if (w.downTimer <= 0) w.setState('getup', w.knockAnim && w.rig.has('rialzata') ? 1.5 : 0.9);
        break;
      case 'getup':
        if (w.stateTime >= w.stateDur) w.setState('idle');
        break;
      case 'taunt':
        w.special = Math.min(100, w.special + 20 * dt);
        this.hype = Math.min(1, this.hype + 0.3 * dt);
        if (w.stateTime >= w.stateDur) w.setState('idle');
        break;
    }
  }

  handleFree(w, o, I, dt) {
    const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z, dist = Math.hypot(dx, dz);
    if (I.pin && o.state === 'down' && dist < 1.4 && !this.pin) return this.startPin(w, o);
    if (I.punch) return this.startStrike(w, o, w.state === 'run' ? 'clothesline' : 'punch', dist);
    if (I.kick) return this.startStrike(w, o, o.state === 'down' && dist < 1.4 ? 'stomp' : 'kick', dist);
    if (I.grab && o.state !== 'down') return this.startGrab(w, o, dist);
    if (I.taunt) { w.vel.set(0, 0, 0); return w.setState('taunt', 1.4); }
    if (I.block) {
      w.vel.set(0, 0, 0);
      w.ensure('block');
      if (dist < 4) w.turnTo(Math.atan2(dx, dz), dt, 12);
      return;
    }
    const len = Math.hypot(I.mx, I.mz);
    if (len > 0.1) {
      const mx = I.mx / len, mz = I.mz / len;
      const spd = (I.run ? RUN_SPEED : WALK_SPEED) * w.speedK;
      w.vel.set(mx * spd, 0, mz * spd);
      w.ensure(I.run ? 'run' : 'walk');
      // camminando vicino all'avversario resta rivolto verso di lui
      const ang = !I.run && dist < 2.2 ? Math.atan2(dx, dz) : Math.atan2(mx, mz);
      w.turnTo(ang, dt, I.run ? 14 : 10);
    } else {
      w.vel.set(0, 0, 0);
      w.ensure('idle');
      if (dist < 5) w.turnTo(Math.atan2(dx, dz), dt, 8);
    }
  }

  startStrike(w, o, type, dist) {
    if (dist < 2.2) {
      if (type === 'clothesline') w.turnTo(Math.atan2(o.pos.x - w.pos.x, o.pos.z - w.pos.z), 1, 0.5);
      else w.faceNow(o.pos);
    }
    w.setState(type, STRIKES[type].dur);
    w.attackSide *= -1;
    if (type !== 'clothesline') w.vel.set(0, 0, 0);
  }

  handleStrike(w, o, dt) {
    const S = STRIKES[w.state];
    if (w.state === 'clothesline') w.vel.multiplyScalar(Math.exp(-2.5 * dt));
    else w.vel.set(0, 0, 0);
    if (!w.hitDone && w.stateTime >= S.from && w.stateTime <= S.to) w.hitDone = this.tryHit(w, o, S);
    if (w.stateTime >= S.dur) w.setState('idle');
  }

  tryHit(w, o, S) {
    if (S.low ? o.state !== 'down' : !o.hittable) return false;
    const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z, dist = Math.hypot(dx, dz);
    if (dist > S.range) return false;
    const f = w.forward;
    if (dist > 0.25 && (f.x * dx + f.z * dz) / dist < S.minDot) return false;
    const dir = dist > 0.01 ? new THREE.Vector3(dx / dist, 0, dz / dist) : f;

    if (o.state === 'block' && !S.unblockable) {
      const of = o.forward;
      if (-(of.x * dir.x + of.z * dir.z) > 0.2) {
        this.damage(w, o, Math.round(S.dmg * 0.2));
        o.vel.copy(dir).multiplyScalar(1.0);
        this.sfx.block();
        return true;
      }
    }

    const whip = o.state === 'whipped' || o.state === 'rebound';
    let dmg = S.dmg, name = S.name, knock = !!S.knock || whip;
    if (whip) { dmg += 7; name = w.state === 'kick' ? 'DROPKICK!' : 'CLOTHESLINE!'; }
    // combo: il quarto colpo ravvicinato manda a terra
    w.combo = this.time - w.lastHit < 0.9 ? w.combo + 1 : 1;
    w.lastHit = this.time;
    if (w.combo >= 4 && !knock && !S.low) { knock = true; name = 'COMBO!'; w.combo = 0; }

    this.damage(w, o, dmg);
    if (S.low) o.downTimer += 0.35;
    else if (knock) this.knockDown(o, dir);
    else { o.setState('stunned', S.stun); o.vel.copy(dir).multiplyScalar(1.4); }
    if (name) this.hud.announce(name);
    this.sfx.hit(S.heavy || knock);
    if (knock) this.fx.shake(0.18);
    return true;
  }

  damage(w, o, dmg) {
    dmg = Math.round(dmg * w.powerK);
    o.hp = Math.max(0, o.hp - dmg);
    w.special = Math.min(100, w.special + dmg * 1.6);
    this.hype = Math.min(1, this.hype + dmg / 40);
  }

  knockDown(o, dir) {
    o.setState('down');
    o.knockAnim = true;
    o.vel.set(0, 0, 0);
    o.forced = null;
    // cade all'indietro rispetto al colpo
    if (dir) o.facing = Math.atan2(-dir.x, -dir.z);
    o.downTimer = 1.0 + (1 - o.hp / 100) * 2.2 + Math.random() * 0.8;
  }

  startGrab(w, o, dist) {
    if (dist < 2.2) w.faceNow(o.pos);
    w.vel.set(0, 0, 0);
    w.setState('grab', 0.5);
  }

  handleGrab(w, o) {
    w.vel.set(0, 0, 0);
    if (!w.hitDone && w.stateTime >= 0.14 && w.stateTime <= 0.26) {
      const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z, dist = Math.hypot(dx, dz);
      const f = w.forward;
      const ok = dist < 0.95 && (dist < 0.25 || (f.x * dx + f.z * dz) / dist > 0.5)
        && o.hittable && o.state !== 'whipped' && o.state !== 'rebound';
      if (ok) {
        w.hitDone = true;
        o.vel.set(0, 0, 0);
        w.setState('hold', 2.4);
        o.setState('held');
        this.sfx.block();
        return;
      }
    }
    if (w.stateTime >= w.stateDur) w.setState('idle');
  }

  handleHold(w, o, I) {
    w.vel.set(0, 0, 0);
    o.vel.set(0, 0, 0);
    const f = w.forward;
    o.pos.set(w.pos.x + f.x * 0.55, MAT_Y, w.pos.z + f.z * 0.55);
    o.facing = w.facing + Math.PI;
    if (I.finisher && w.special >= 100) return this.startThrow(w, o, 'powerbomb');
    if (I.punch) return this.startThrow(w, o, 'suplex');
    if (I.kick) return this.startThrow(w, o, 'slam');
    if (I.grab) return this.startWhip(w, o);
    if (w.stateTime > w.stateDur) {
      w.setState('idle');
      o.setState('stunned', 0.3);
      o.vel.copy(f).multiplyScalar(1.5);
    }
  }

  startThrow(w, o, type) {
    const M = THROWS[type];
    this.move = { type, M, a: w, v: o, t: 0, A: w.pos.clone(), f: w.forward };
    w.setState('lifting');
    o.setState('thrown');
    if (M.special) { w.special = 0; this.fx.flash(); }
    this.hud.announce(M.name, M.special ? '' : 'blue');
  }

  updateMove(dt) {
    const m = this.move;
    m.t += dt;
    const p = Math.min(1, m.t / m.M.dur);
    m.M.animate(m, p);
    if (p < 1) return;
    const { a, v, M } = m;
    a.forced = v.forced = null;
    this.damage(a, v, M.dmg);
    this.knockDown(v, null);
    v.downTimer += M.dmg / 18;
    v.lastBig = !!M.special;
    v.snapBody();
    if (m.type === 'suplex') { a.setState('down'); a.downTimer = 0.35; a.snapBody(); }
    else a.setState('idle');
    this.sfx.slam(!!M.special);
    this.fx.shake(M.special ? 0.6 : 0.3);
    this.hype = Math.min(1, this.hype + (M.special ? 0.8 : 0.35));
    this.move = null;
  }

  startWhip(w, o) {
    const f = w.forward;
    o.setState('whipped');
    o.facing = w.facing;
    o.vel.copy(f).multiplyScalar(RUN_SPEED * 1.1);
    w.setState('idle');
    this.hud.announce('IRISH WHIP!', 'blue');
  }

  handleWhip(w, o) {
    const v = w.vel;
    let bounced = null;
    if (Math.abs(w.pos.x) >= RING_HALF - 0.02 && Math.sign(v.x) === Math.sign(w.pos.x)) { v.x = -v.x; bounced = ['x', Math.sign(w.pos.x)]; }
    if (Math.abs(w.pos.z) >= RING_HALF - 0.02 && Math.sign(v.z) === Math.sign(w.pos.z)) { v.z = -v.z; bounced = ['z', Math.sign(w.pos.z)]; }
    if (bounced) {
      // il tempo del rimbalzo parte dalla prima corda: dopo 1.5 s il lottatore si ferma comunque
      if (w.state !== 'rebound') w.setState('rebound');
      w.facing = Math.atan2(v.x, v.z);
      this.fx.rope(...bounced);
      this.sfx.rope();
      return;
    }
    if (w.state === 'rebound') {
      const dist = w.pos.distanceTo(o.pos);
      if (w.stateTime > 1.5) { w.vel.multiplyScalar(0.3); w.setState('idle'); }
      else if (dist < 0.65 && o.hittable && !ATTACKING.has(o.state)) {
        // chi rimbalza sulle corde travolge l'avversario fermo, a meno che non pari
        if (o.state === 'block') {
          w.setState('stunned', 0.6);
          w.vel.multiplyScalar(-0.3);
          this.sfx.block();
        } else {
          const dir = o.pos.clone().sub(w.pos).setY(0).normalize();
          this.damage(w, o, 6);
          this.knockDown(o, dir);
          w.vel.set(0, 0, 0);
          w.setState('idle');
          this.hud.announce('SHOULDER TACKLE!', 'blue');
          this.sfx.hit(true);
        }
      }
    } else if (w.stateTime > 3) w.setState('idle');
  }

  startPin(w, o) {
    const side = o.side;
    if (side.dot(w.pos.clone().sub(o.pos)) < 0) side.negate();
    const f = o.forward;
    w.pos.set(o.pos.x + side.x * 0.45 - f.x * 0.25, MAT_Y, o.pos.z + side.z * 0.45 - f.z * 0.25);
    w.facing = Math.atan2(-side.x, -side.z);
    w.vel.set(0, 0, 0);
    w.setState('pinning');
    o.setState('pinned');
    // CPU: decide in anticipo se e quando liberarsi, in base all'energia rimasta
    let chance = Math.min(0.97, 0.12 + (o.hp / 100) * 1.15);
    if (o.lastBig) chance -= 0.35;
    this.pin = { a: w, v: o, side, t: 0, count: 0, countT: 0, bar: 0, refReady: false,
      kickAt: Math.random() < chance ? 0.9 + Math.random() * 1.95 : null };
    this.hud.announce('SCHIENAMENTO!', 'blue');
  }

  updatePin(dt, I) {
    const P = this.pin;
    P.t += dt;
    if (!P.refReady) {
      if (P.t > 1.6) P.refReady = true;
      return;
    }
    P.countT += dt;
    const cnt = P.countT / 0.85;
    const frac = cnt - Math.floor(cnt);
    // la mano scende e batte sul tappeto proprio allo scoccare di ogni conteggio
    this.ref.slap = frac > 0.65 ? (frac - 0.65) / 0.35 : Math.max(0, 1 - frac * 4);
    const human = this.humans.has(P.v);
    if (human) {
      P.bar = Math.max(0, P.bar - 0.35 * dt);
      if (I.mash) P.bar += 0.09 + 0.07 * (P.v.hp / 100) - (P.v.lastBig ? 0.03 : 0);
      if (P.v === this.p1) this.hud.kickBar(P.bar);
    }
    const kicked = human ? P.bar >= 1 : P.kickAt != null && cnt >= P.kickAt;
    if (kicked) {
      this.hud.kickBar(null);
      this.hud.announce(P.count >= 2 ? 'KICK OUT A 2!' : 'KICK OUT!');
      this.hype = Math.min(1, this.hype + 0.5);
      this.sfx.crowd(0.8);
      P.v.setState('down');
      P.v.downTimer = 0.5;
      P.v.lastBig = false;
      P.a.setState('getup', 0.7);
      this.ref.setState('idle');
      this.pin = null;
      return;
    }
    if (Math.floor(cnt) > P.count) {
      P.count = Math.floor(cnt);
      this.hud.count(P.count);
      this.sfx.slap();
      if (P.count >= 3) this.finish(P.a, P.v);
    }
  }

  finish(winner, loser) {
    this.hud.kickBar(null);
    this.phase = 'over';
    this.winner = winner;
    this.pin = null;
    winner.setState('celebrate');
    loser.setState('down');
    loser.downTimer = Infinity;
    this.ref.setState('idle');
    this.staff.boss.setState('cheer');
    // punto libero al centro, lontano da chi è steso
    const spot = new THREE.Vector3(loser.pos.x > 0 ? -0.9 : 0.9, 0, 1.6);
    this.outro = { step: 0, t: 0, spot, done: false, line: CLEANUP_LINES[(Math.random() * CLEANUP_LINES.length) | 0] };
    this.hype = 1;
    this.sfx.bell(3);
    this.sfx.crowd(1);
  }

  updateRef(dt) {
    const r = this.ref;
    let target;
    if (this.pin) {
      const { v, side } = this.pin;
      const f = v.forward;
      target = v.pos.clone().addScaledVector(side, -0.75).addScaledVector(f, -0.5);
    } else {
      const a = this.p1.pos, b = this.p2.pos;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a).setY(0);
      if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
      d.normalize();
      const perp = new THREE.Vector3(-d.z, 0, d.x);
      const c1 = mid.clone().addScaledVector(perp, 2.2), c2 = mid.clone().addScaledVector(perp, -2.2);
      target = c1.z < c2.z ? c1 : c2; // resta sul lato lontano dalla telecamera
    }
    const lim = RING_HALF - 0.2;
    target.x = THREE.MathUtils.clamp(target.x, -lim, lim);
    target.z = THREE.MathUtils.clamp(target.z, -lim, lim);
    const dx = target.x - r.pos.x, dz = target.z - r.pos.z, dist = Math.hypot(dx, dz);
    const look = this.pin ? this.pin.v.pos : this.p1.pos.clone().add(this.p2.pos).multiplyScalar(0.5);

    if (this.pin && (dist < 0.25 || this.pin.refReady)) {
      if (!this.pin.refReady) this.pin.refReady = true;
      r.vel.set(0, 0, 0);
      r.ensure('refCount');
      r.turnTo(Math.atan2(look.x - r.pos.x, look.z - r.pos.z), dt, 10);
      return;
    }
    if (dist > 0.35) {
      const spd = this.pin ? 4 : 1.8;
      const s = Math.min(spd, dist * 3);
      r.vel.set((dx / dist) * s, 0, (dz / dist) * s);
      r.ensure(s > 2.6 ? 'run' : 'walk');
      r.turnTo(Math.atan2(dx, dz), dt, 10);
    } else {
      r.vel.set(0, 0, 0);
      r.ensure('idle');
      r.turnTo(Math.atan2(look.x - r.pos.x, look.z - r.pos.z), dt, 6);
    }
  }

  // i due lottatori non si compenetrano; l'arbitro si scansa
  collide() {
    const push = (a, b, min, both) => {
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-4) return;
      const k = (min - d) / d;
      if (both) { a.pos.x -= dx * k / 2; a.pos.z -= dz * k / 2; b.pos.x += dx * k / 2; b.pos.z += dz * k / 2; }
      else { b.pos.x += dx * k; b.pos.z += dz * k; }
    };
    const { p1, p2, ref } = this;
    if (!this.move && !SOLID_SKIP.has(p1.state) && !SOLID_SKIP.has(p2.state)) push(p1, p2, 0.55, true);
    if (!this.pin) { push(p1, ref, 0.6, false); push(p2, ref, 0.6, false); }
  }

  keepInRing(w) {
    const lim = RING_HALF;
    for (const axis of ['x', 'z']) {
      const v = w.pos[axis];
      if (Math.abs(v) <= lim) continue;
      w.pos[axis] = Math.sign(v) * lim;
      // chi corre contro le corde le fa vibrare
      if (!w.isRef && Math.abs(w.vel[axis]) > 3 && w.ropeCd <= 0) {
        w.ropeCd = 0.5;
        this.fx.rope(axis, Math.sign(v));
        this.sfx.rope();
      }
    }
  }

  // suggerimento contestuale per il giocatore
  promptFor(p, o) {
    if (this.outro?.step >= 4) return `${this.staff.boss.name}: «${this.outro.line}»`;
    if (this.phase !== 'fight') return '';
    if (this.pin?.v === p) return '';
    if (p.state === 'hold') return `J Suplex · K Body Slam · L Irish Whip${p.special >= 100 ? ' · F POWERBOMB!' : ''}`;
    if (p.state === 'down') return 'Premi i tasti velocemente per rialzarti';
    if (o.state === 'down' && p.canAct && p.pos.distanceTo(o.pos) < 1.4) return 'SPAZIO schienamento · K calcio a terra';
    if (o.state === 'rebound' && p.canAct) return 'J Clothesline · K Dropkick!';
    if (p.special >= 100 && p.canAct) return 'SPECIAL pronto: afferra (L) e premi F';
    return '';
  }
}
