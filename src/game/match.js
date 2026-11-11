// Regole del match (1 contro 1 o 2 contro 2, vittoria per schienamento o count-out) e risoluzione di colpi, prese,
// proiezioni, uscite dal ring e oggetti (sedie e tavoli).
import * as THREE from 'three';
import { RING_HALF, RUN_SPEED, WALK_SPEED, MAT_Y, APRON, OUT_MIN, OUT_MAX } from './wrestler.js';

const STRIKES = {
  punch:       { dur: 0.42, from: 0.09, to: 0.2, range: 0.95, minDot: 0.55, dmg: 4, stun: 0.35, heavy: false },
  kick:        { dur: 0.62, from: 0.18, to: 0.32, range: 1.15, minDot: 0.6, dmg: 7, stun: 0.55, heavy: true },
  stomp:       { dur: 0.6, from: 0.2, to: 0.32, range: 1.25, minDot: 0.2, dmg: 5, low: true, heavy: true },
  clothesline: { dur: 0.7, from: 0.06, to: 0.4, range: 1.0, minDot: 0.45, dmg: 10, knock: true, unblockable: true, heavy: true, name: 'CLOTHESLINE!' },
  swing:       { dur: 0.75, from: 0.3, to: 0.48, range: 1.35, minDot: 0.4, dmg: 16, knock: true, heavy: true, name: 'COLPO DI SEDIA!' },
};

// cosa dice Max Malpensa salendo sul ring a fine incontro
const CLEANUP_LINES = [
  'Bel match, ragazzi! Adesso però pulite tutto!',
  'Applausi per tutti! E ora scope e stracci: pulite tutto il ring!',
  'Spettacolo! Ma prima di andare a casa, qui si pulisce tutto!',
];
const CLEANUP_MESS = 'Spettacolo! Ma chi mi ripaga sedie e tavoli? Pulite tutto!';

const COUNT_STEP = 1.5;   // secondi per ogni numero del conteggio fuori dal ring (fino a 10)
const PUSH_TIME = 0.4;    // quanto spingere contro le corde per uscire o rientrare

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
    v.pos.set(A.x + f.x * d, A.y, A.z + f.z * d);
    v.forced = { tiltX: (-Math.PI / 2) * Math.min(1, p / up), lift: height * h + v.LIFT_DOWN * drop };
  };
}

// suplex: la vittima passa sopra la testa e cade dietro, l'attaccante cade all'indietro con lei
function suplex(m, p) {
  const { a, v, A, f } = m;
  v.facing = a.facing + Math.PI;
  const e = ease(p);
  const d = 0.55 + (-1.65 - 0.55) * e;
  v.pos.set(A.x + f.x * d, A.y, A.z + f.z * d);
  v.forced = { tiltX: 1.5 * Math.PI * e, lift: v.LIFT_DOWN * e + 1.25 * Math.sin(Math.PI * p) };
  const q = ease(Math.max(0, (p - 0.3) / 0.7));
  a.forced = { tiltX: (-Math.PI / 2) * q, lift: a.LIFT_DOWN * q };
}

const THROWS = {
  suplex: { name: 'SUPLEX!', dur: 1.25, dmg: 13, animate: suplex },
  slam: { name: 'BODY SLAM!', dur: 1.05, dmg: 11, animate: liftAndSlam(1.0, 0.55, 0, 0.95) },
  powerbomb: { name: 'POWERBOMB!!!', dur: 1.75, dmg: 30, special: true, animate: liftAndSlam(1.35, 0.38, 0.27, 0.9) },
};

const ATTACKING = new Set(['punch', 'kick', 'clothesline', 'swing']);
const SOLID_SKIP = new Set(['held', 'hold', 'thrown', 'lifting', 'pinning', 'pinned', 'ropes', 'flying']);

export class Match {
  // teams: [[p1, compagno?], [p2, compagno?]]; p1 è il giocatore di questo schermo, p2 il suo avversario principale.
  // humans: lottatori guidati da persone (si liberano dallo schienamento premendo i tasti);
  // la barra per liberarsi si vede solo per p1
  constructor({ teams, ref, staff, hud, sfx, fx, props, humans }) {
    Object.assign(this, { teams, ref, staff, hud, sfx, fx, props });
    this.p1 = teams[0][0];
    this.p2 = teams[1][0];
    // ordine fisso (anche per il multiplayer): i due capitani, poi i compagni
    this.fighters = [teams[0][0], teams[1][0], teams[0][1], teams[1][1]].filter(Boolean);
    teams.forEach((t, i) => t.forEach((w) => { w.team = i; }));
    this.humans = new Set(humans ?? [this.p1]);
    this.reset();
  }

  get tag() { return this.fighters.length > 2; }
  opponents(w) { return this.fighters.filter((f) => f.team !== w.team); }
  mates(w) { return this.fighters.filter((f) => f !== w && f.team === w.team); }

  // avversario di riferimento: il più vicino, preferendo chi è nella stessa zona (sul ring o fuori)
  target(w) {
    let best = null, bd = Infinity;
    for (const o of this.opponents(w)) {
      const d = w.pos.distanceToSquared(o.pos) + (o.out !== w.out ? 60 : 0) + (o.state === 'pinned' ? 30 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  reset() {
    const spots = [[-1.8, 0.9, Math.PI / 2], [1.8, -0.9, -Math.PI / 2], [-2.4, -1.6, Math.PI / 2], [2.4, 1.6, -Math.PI / 2]];
    this.fighters.forEach((w, i) => w.reset(...spots[i]));
    this.props?.reset();
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
    this.moves = [];
    this.pin = null;
    this.winner = null;
    this.winTeam = null;
    this.outro = null;
    this.ringCount = 0;
    this.broken = 0;
    this.hud.ringOut(null);
    this.hud.announce(`${speaker.name} presenta…`, 'blue');
  }

  teamName(i) { return this.teams[i].map((w) => w.name).join(' & '); }

  updateStaff(dt) {
    const { speaker, boss } = this.staff;
    if (this.phase === 'intro' && this.introStep === 0 && this.time > 1.5) {
      this.introStep = 1;
      this.hud.announce(`${this.teamName(0)}  vs  ${this.teamName(1)}`);
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

  // intents: comandi di ciascun lottatore, nello stesso ordine di this.fighters
  update(dt, intents) {
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
    for (const m of [...this.moves]) this.updateMove(m, dt);
    if (this.pin) this.updatePin(dt, intents[this.fighters.indexOf(this.pin.v)]);
    if (this.phase === 'fight') {
      this.fighters.forEach((w, i) => this.handle(w, this.target(w), intents[i], dt));
      this.updateCountOut(dt);
    }
    this.collide();
    this.updateRef(dt);
    this.updateStaff(dt);
    for (const w of [...this.fighters, this.ref]) {
      w.update(dt);
      this.keepInBounds(w);
    }
    this.props.update(dt);
    this.hud.setBars(this.fighters);
  }

  handle(w, o, I, dt) {
    switch (w.state) {
      case 'idle': case 'walk': case 'run': case 'block': case 'carry':
        this.handleFree(w, o, I, dt); break;
      case 'punch': case 'kick': case 'stomp': case 'clothesline': case 'swing':
        this.handleStrike(w, dt); break;
      case 'grab': this.handleGrab(w); break;
      case 'hold': this.handleHold(w, I); break;
      case 'whipped': case 'rebound': this.handleWhip(w); break;
      case 'ropes': case 'flying': this.handleTransit(w); break;
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
    if (this.ropePush(w, I, dt)) return;
    if (!o) return;
    const dx = o.pos.x - w.pos.x, dz = o.pos.z - w.pos.z, dist = Math.hypot(dx, dz);
    if (w.carry) return this.handleCarry(w, o, I, dt, dist);
    if (I.pin) { const v = this.pinnable(w); if (v) return this.startPin(w, v); }
    if (I.punch) return this.startStrike(w, o, w.state === 'run' ? 'clothesline' : 'punch', dist);
    if (I.kick) return this.startStrike(w, o, o.state === 'down' && dist < 1.4 ? 'stomp' : 'kick', dist);
    if (I.grab) {
      // vicino a una sedia (e senza un avversario a portata di presa) si prende la sedia
      const chair = this.props.chairNear(w.pos, 0.9);
      if (chair && !(o.hittable && o.out === w.out && dist < 0.95)) return this.props.pickUp(w, chair), w.setState('carry');
      if (o.state !== 'down') return this.startGrab(w, o, dist);
    }
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

  // con la sedia in mano: si cammina, J colpisce, L la posa
  handleCarry(w, o, I, dt, dist) {
    if (I.grab) { this.props.drop(w); return w.setState('idle'); }
    if (I.punch) {
      if (dist < 2.4) w.faceNow(o.pos);
      w.vel.set(0, 0, 0);
      return w.setState('swing', STRIKES.swing.dur);
    }
    const len = Math.hypot(I.mx, I.mz);
    w.ensure('carry');
    if (len > 0.1) {
      const spd = WALK_SPEED * 1.15 * w.speedK;
      w.vel.set((I.mx / len) * spd, 0, (I.mz / len) * spd);
      w.turnTo(Math.atan2(I.mx, I.mz), dt, 10);
    } else {
      w.vel.set(0, 0, 0);
      if (dist < 5) w.turnTo(Math.atan2(o.pos.x - w.pos.x, o.pos.z - w.pos.z), dt, 8);
    }
  }

  // spingendo per un attimo contro le corde si esce dal ring; da fuori, spingendo contro il bordo, si rientra
  ropePush(w, I, dt) {
    const len = Math.hypot(I.mx, I.mz);
    let dest = null;
    if (len > 0.5) {
      const m = { x: I.mx / len, z: I.mz / len };
      for (const axis of ['x', 'z']) {
        const other = axis === 'x' ? 'z' : 'x', s = Math.sign(w.pos[axis]);
        if (Math.abs(m[axis]) < 0.6) continue;
        if (!w.out && Math.abs(w.pos[axis]) >= RING_HALF - 0.08 && Math.sign(m[axis]) === s) {
          dest = new THREE.Vector3();
          dest[axis] = s * 4.75;
          dest[other] = THREE.MathUtils.clamp(w.pos[other], -3.9, 3.9);
          dest.y = 0;
        } else if (w.out && Math.abs(w.pos[axis]) < OUT_MIN + 0.3 && Math.abs(w.pos[other]) < 3.9 && Math.sign(m[axis]) === -s) {
          dest = new THREE.Vector3();
          dest[axis] = s * (RING_HALF - 0.3);
          dest[other] = THREE.MathUtils.clamp(w.pos[other], -3.2, 3.2);
          dest.y = MAT_Y;
        }
        if (dest) break;
      }
    }
    if (!dest || w.state === 'block' || I.cross === false) { w.pushT = 0; return false; }
    w.pushT += dt;
    if (w.pushT < PUSH_TIME) return false;
    w.pushT = 0;
    this.startTransit(w, dest, false);
    return true;
  }

  // passaggio tra le corde (ropes) o volo oltre la terza corda (flying)
  startTransit(w, to, fall) {
    w.setState(fall ? 'flying' : 'ropes', fall ? 0.85 : 0.8);
    w.transit = { from: w.pos.clone(), to, fall };
    w.vel.set(0, 0, 0);
    w.faceNow(fall ? { x: 2 * w.pos.x - to.x, z: 2 * w.pos.z - to.z } : to);
  }

  handleTransit(w) {
    const T = w.transit;
    if (!T) { w.setState('idle'); return; }
    const p = Math.min(1, w.stateTime / w.stateDur), e = ease(p);
    w.pos.x = T.from.x + (T.to.x - T.from.x) * e;
    w.pos.z = T.from.z + (T.to.z - T.from.z) * e;
    w.pos.y = T.from.y + (T.to.y - T.from.y) * (T.fall ? p * p : e) + (T.fall ? 1.0 : 0.25) * Math.sin(Math.PI * p);
    if (T.fall) w.forced = { tiltX: (-Math.PI / 2) * Math.min(1, p * 1.5), lift: w.LIFT_DOWN * p };
    if (p < 1) return;
    w.pos.copy(T.to);
    w.out = T.to.y < MAT_Y / 2;
    w.transit = null;
    w.forced = null;
    if (!T.fall) { w.setState('idle'); return; }
    // atterraggio sul pavimento (o su un tavolo)
    this.knockDown(w, null);
    w.downTimer += 1;
    w.snapBody();
    w.hp = Math.max(0, w.hp - 6);
    if (!this.tableSmash(w)) { this.sfx.slam(false); this.fx.shake(0.35); }
  }

  // tavolo sotto chi è appena caduto fuori dal ring: si spacca
  tableSmash(v) {
    const t = v.out && this.props.tableAt(v.pos);
    if (!t) return false;
    this.props.smash(t.id, 0, 0);
    this.broken++;
    v.hp = Math.max(0, v.hp - 10);
    v.downTimer += 1.2;
    v.lastBig = true;
    this.hud.announce('ATTRAVERSO IL TAVOLO!!!');
    this.sfx.slam(true);
    this.fx.shake(0.7);
    this.fx.flash();
    this.hype = 1;
    return true;
  }

  pinnable(w) {
    if (this.pin || w.out) return null;
    return this.opponents(w).find((o) => o.state === 'down' && !o.out && w.pos.distanceTo(o.pos) < 1.4) || null;
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

  handleStrike(w, dt) {
    const S = STRIKES[w.state];
    if (w.state === 'clothesline') w.vel.multiplyScalar(Math.exp(-2.5 * dt));
    else w.vel.set(0, 0, 0);
    if (!w.hitDone && w.stateTime >= S.from && w.stateTime <= S.to) w.hitDone = this.tryHit(w, S);
    if (w.stateTime >= S.dur) w.setState(w.carry ? 'carry' : 'idle');
  }

  // il colpo raggiunge l'avversario più vicino davanti a sé (anche chi sta schienando un compagno)
  tryHit(w, S) {
    let o = null, best = Infinity, dx = 0, dz = 0;
    for (const c of this.opponents(w)) {
      if (c.out !== w.out) continue;
      if (S.low ? c.state !== 'down' : !(c.hittable || c.state === 'pinning')) continue;
      const cx = c.pos.x - w.pos.x, cz = c.pos.z - w.pos.z, d = Math.hypot(cx, cz);
      if (d > S.range) continue;
      const f = w.forward;
      if (d > 0.25 && (f.x * cx + f.z * cz) / d < S.minDot) continue;
      if (d < best) { best = d; o = c; dx = cx; dz = cz; }
    }
    if (!o) return false;
    const dist = best, f = w.forward;
    const dir = dist > 0.01 ? new THREE.Vector3(dx / dist, 0, dz / dist) : f;
    const chair = w.state === 'swing' ? w.carry : null;
    if (chair) { this.props.smash(chair.id, dir.x, dir.z); this.broken++; }

    if (o.state === 'block' && !S.unblockable) {
      const of = o.forward;
      if (-(of.x * dir.x + of.z * dir.z) > 0.2) {
        this.damage(w, o, Math.round(S.dmg * (chair ? 0.4 : 0.2)));
        o.vel.copy(dir).multiplyScalar(1.0);
        this.sfx.block();
        if (chair) { this.sfx.hit(true); this.fx.shake(0.2); }
        return true;
      }
    }
    if (o.state === 'pinning') this.breakPin();
    if (o.carry) this.props.drop(o);

    const whip = o.state === 'whipped' || o.state === 'rebound';
    let dmg = S.dmg, name = S.name, knock = !!S.knock || whip;
    if (whip) { dmg += 7; name = w.state === 'kick' ? 'DROPKICK!' : 'CLOTHESLINE!'; }
    // combo: il quarto colpo ravvicinato manda a terra
    w.combo = this.time - w.lastHit < 0.9 ? w.combo + 1 : 1;
    w.lastHit = this.time;
    if (w.combo >= 4 && !knock && !S.low) { knock = true; name = 'COMBO!'; w.combo = 0; }

    this.damage(w, o, dmg);
    if (S.low) o.downTimer += 0.35;
    else if (knock) {
      // vicino alle corde un colpo forte lo manda oltre la terza corda, giù dal ring
      const edge = this.overTheTop(o, dir);
      if (edge) { this.startTransit(o, edge, true); name = 'FUORI DAL RING!'; this.hype = Math.min(1, this.hype + 0.4); }
      else this.knockDown(o, dir);
    } else { o.setState('stunned', S.stun); o.vel.copy(dir).multiplyScalar(1.4); }
    if (name) this.hud.announce(name);
    this.sfx.hit(S.heavy || knock);
    if (knock) this.fx.shake(chair ? 0.4 : 0.18);
    return true;
  }

  overTheTop(o, dir) {
    if (o.out) return null;
    for (const axis of ['x', 'z']) {
      const s = Math.sign(o.pos[axis]), other = axis === 'x' ? 'z' : 'x';
      if (Math.abs(o.pos[axis]) > RING_HALF - 0.55 && dir[axis] * s > 0.5) {
        const to = new THREE.Vector3(0, 0, 0);
        to[axis] = s * 5.1;
        to[other] = THREE.MathUtils.clamp(o.pos[other] + dir[other] * 0.8, -4.2, 4.2);
        return to;
      }
    }
    return null;
  }

  damage(w, o, dmg) {
    dmg = Math.round(dmg * w.powerK);
    o.hp = Math.max(0, o.hp - dmg);
    w.special = Math.min(100, w.special + dmg * 1.6);
    this.hype = Math.min(1, this.hype + dmg / 40);
  }

  knockDown(o, dir) {
    if (o.carry) this.props.drop(o);
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

  handleGrab(w) {
    w.vel.set(0, 0, 0);
    if (!w.hitDone && w.stateTime >= 0.14 && w.stateTime <= 0.26) {
      const f = w.forward;
      const o = this.opponents(w).find((c) => {
        const dx = c.pos.x - w.pos.x, dz = c.pos.z - w.pos.z, dist = Math.hypot(dx, dz);
        return c.out === w.out && dist < 0.95 && (dist < 0.25 || (f.x * dx + f.z * dz) / dist > 0.5)
          && c.hittable && c.state !== 'whipped' && c.state !== 'rebound';
      });
      if (o) {
        w.hitDone = true;
        if (o.carry) this.props.drop(o);
        o.vel.set(0, 0, 0);
        w.setState('hold', 2.4);
        w.held = o;
        o.setState('held');
        this.sfx.block();
        return;
      }
    }
    if (w.stateTime >= w.stateDur) w.setState('idle');
  }

  handleHold(w, I) {
    const o = w.held;
    if (!o || o.state !== 'held') { w.held = null; w.setState('idle'); return; }
    w.vel.set(0, 0, 0);
    o.vel.set(0, 0, 0);
    const f = w.forward;
    o.pos.set(w.pos.x + f.x * 0.55, w.pos.y, w.pos.z + f.z * 0.55);
    o.facing = w.facing + Math.PI;
    if (I.finisher && w.special >= 100) return this.startThrow(w, o, 'powerbomb');
    if (I.punch) return this.startThrow(w, o, 'suplex');
    if (I.kick) return this.startThrow(w, o, 'slam');
    if (I.grab) return this.startWhip(w, o);
    if (w.stateTime > w.stateDur) {
      w.held = null;
      w.setState('idle');
      o.setState('stunned', 0.3);
      o.vel.copy(f).multiplyScalar(1.5);
    }
  }

  startThrow(w, o, type) {
    const M = THROWS[type];
    w.held = null;
    this.moves.push({ type, M, a: w, v: o, t: 0, A: w.pos.clone(), f: w.forward });
    w.setState('lifting');
    o.setState('thrown');
    if (M.special) { w.special = 0; this.fx.flash(); }
    this.hud.announce(M.name, M.special ? '' : 'blue');
  }

  updateMove(m, dt) {
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
    if (!this.tableSmash(v)) {
      this.sfx.slam(!!M.special);
      this.fx.shake(M.special ? 0.6 : 0.3);
    }
    this.hype = Math.min(1, this.hype + (M.special ? 0.8 : 0.35));
    this.moves.splice(this.moves.indexOf(m), 1);
  }

  startWhip(w, o) {
    const f = w.forward;
    w.held = null;
    o.setState('whipped');
    o.facing = w.facing;
    o.vel.copy(f).multiplyScalar(RUN_SPEED * 1.1);
    w.setState('idle');
    this.hud.announce('IRISH WHIP!', 'blue');
  }

  handleWhip(w) {
    const v = w.vel;
    // fuori dal ring: contro le transenne o contro il bordo del ring
    if (w.out) {
      let wall = null;
      for (const axis of ['x', 'z']) {
        const other = axis === 'x' ? 'z' : 'x', s = Math.sign(w.pos[axis]);
        if (Math.abs(w.pos[axis]) >= OUT_MAX - 0.1 && Math.sign(v[axis]) === s) wall = 'CONTRO LE TRANSENNE!';
        if (Math.abs(w.pos[axis]) <= OUT_MIN + 0.1 && Math.abs(w.pos[other]) < OUT_MIN && Math.sign(v[axis]) === -s) wall = 'CONTRO IL RING!';
      }
      if (wall) {
        w.hp = Math.max(0, w.hp - 8);
        this.knockDown(w, v.clone().normalize());
        this.hud.announce(wall);
        this.sfx.hit(true);
        this.fx.shake(0.35);
        this.hype = Math.min(1, this.hype + 0.3);
      } else if (w.stateTime > 2) w.setState('idle');
      return;
    }
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
      if (w.stateTime > 1.5) { w.vel.multiplyScalar(0.3); w.setState('idle'); return; }
      // chi rimbalza sulle corde travolge l'avversario fermo, a meno che non pari
      const o = this.opponents(w).find((c) => !c.out && w.pos.distanceTo(c.pos) < 0.65 && c.hittable && !ATTACKING.has(c.state));
      if (!o) return;
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
    } else if (w.stateTime > 3) w.setState('idle');
  }

  startPin(w, o) {
    const side = o.side;
    if (side.dot(w.pos.clone().sub(o.pos)) < 0) side.negate();
    const f = o.forward;
    w.pos.set(o.pos.x + side.x * 0.45 - f.x * 0.25, o.pos.y, o.pos.z + side.z * 0.45 - f.z * 0.25);
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

  // un compagno colpisce chi sta schienando: il conteggio si interrompe
  breakPin() {
    const P = this.pin;
    if (!P) return;
    this.pin = null;
    this.hud.kickBar(null);
    P.v.setState('down');
    P.v.downTimer = 0.6;
    P.v.lastBig = false;
    this.ref.setState('idle');
    this.ref.slap = 0;
    this.hud.announce('SCHIENAMENTO INTERROTTO!', 'blue');
    this.sfx.crowd(0.8);
    this.hype = Math.min(1, this.hype + 0.5);
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
      if (I?.mash) P.bar += 0.09 + 0.07 * (P.v.hp / 100) - (P.v.lastBig ? 0.03 : 0);
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
      if (P.count >= 3) this.finish(P.a.team, P.a, P.v);
    }
  }

  // conteggio fuori dal ring: chi resta fuori fino a 10 perde (con la sua squadra)
  updateCountOut(dt) {
    let worst = null;
    for (const f of this.fighters) {
      if (f.out) f.outT += dt; else f.outT = 0;
      if (f.outT > 0 && (!worst || f.outT > worst.outT)) worst = f;
    }
    const n = worst ? Math.min(10, Math.floor(worst.outT / COUNT_STEP)) : 0;
    if (n === this.ringCount) return;
    this.ringCount = n;
    this.hud.ringOut(n > 0 ? n : null);
    if (n >= 10) {
      this.hud.announce('COUNT-OUT!');
      this.finish(1 - worst.team, null, worst);
    }
  }

  finish(team, winner, loser) {
    this.hud.kickBar(null);
    this.hud.ringOut(null);
    this.phase = 'over';
    this.winTeam = team;
    this.winner = winner || this.teams[team][0];
    this.howWon = winner ? 'pin' : 'countout';
    this.pin = null;
    for (const w of this.teams[team]) if (!SOLID_SKIP.has(w.state) || w === winner) { if (w.carry) this.props.drop(w); w.setState('celebrate'); }
    if (winner) { loser.setState('down'); loser.downTimer = Infinity; }
    for (const w of this.teams[1 - team]) if (w.state === 'down') w.downTimer = Infinity;
    this.ref.setState('idle');
    this.staff.boss.setState('cheer');
    // punto libero al centro, lontano da chi è steso
    const spot = new THREE.Vector3(loser.pos.x > 0 ? -0.9 : 0.9, 0, 1.6);
    const line = this.broken >= 2 ? CLEANUP_MESS : CLEANUP_LINES[(Math.random() * CLEANUP_LINES.length) | 0];
    this.outro = { step: 0, t: 0, spot, done: false, line };
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
      // segue l'azione sul ring: baricentro delle due squadre
      const inRing = this.fighters.filter((f) => !f.out);
      const team = (t) => {
        const l = inRing.filter((f) => f.team === t);
        const src = l.length ? l : this.teams[t];
        return src.reduce((acc, f) => acc.add(f.pos), new THREE.Vector3()).multiplyScalar(1 / src.length);
      };
      const a = team(0), b = team(1);
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

  // i lottatori non si compenetrano; l'arbitro e lo staff si scansano, i tavoli si aggirano
  collide() {
    const push = (a, b, min, both) => {
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-4) return;
      const k = (min - d) / d;
      if (both) { a.pos.x -= dx * k / 2; a.pos.z -= dz * k / 2; b.pos.x += dx * k / 2; b.pos.z += dz * k / 2; }
      else { b.pos.x += dx * k; b.pos.z += dz * k; }
    };
    const busy = new Set(this.moves.flatMap((m) => [m.a, m.v]));
    const solid = this.fighters.filter((f) => !busy.has(f) && !SOLID_SKIP.has(f.state));
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) if (solid[i].out === solid[j].out) push(solid[i], solid[j], 0.55, true);
    }
    for (const f of this.fighters) {
      if (!this.pin && !f.out) push(f, this.ref, 0.6, false);
      if (f.out && !SOLID_SKIP.has(f.state)) {
        for (const s of [this.staff.speaker, this.staff.boss]) if (s.pos.y < 0.5) push(s, f, 0.6, false);
        this.props.collide(f);
      }
    }
  }

  keepInBounds(w) {
    if (w.state === 'ropes' || w.state === 'flying') return;
    if (w.out) {
      w.pos.x = THREE.MathUtils.clamp(w.pos.x, -OUT_MAX, OUT_MAX);
      w.pos.z = THREE.MathUtils.clamp(w.pos.z, -OUT_MAX, OUT_MAX);
      const ax = Math.abs(w.pos.x), az = Math.abs(w.pos.z);
      if (ax < OUT_MIN && az < OUT_MIN) {
        if (OUT_MIN - ax < OUT_MIN - az) w.pos.x = Math.sign(w.pos.x || 1) * OUT_MIN;
        else w.pos.z = Math.sign(w.pos.z || 1) * OUT_MIN;
      }
      return;
    }
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
  promptFor(p) {
    if (this.outro?.step >= 4) return `${this.staff.boss.name}: «${this.outro.line}»`;
    if (this.phase !== 'fight') return '';
    if (this.pin?.v === p) return '';
    const o = this.target(p);
    if (!o) return '';
    if (p.state === 'hold') {
      const table = p.out && this.props.tableNear(p.pos, 2.3);
      return `J Suplex · K Body Slam${table ? ' (sul tavolo!)' : ''} · L Irish Whip${p.special >= 100 ? ' · F POWERBOMB!' : ''}`;
    }
    if (p.state === 'down') return 'Premi i tasti velocemente per rialzarti';
    if (p.carry) return 'J colpisci con la sedia · L posala';
    if (this.pin && this.pin.v.team === p.team && p.canAct) return `Interrompi lo schienamento: colpisci ${this.pin.a.name}!`;
    if (p.out && p.outT > COUNT_STEP * 4 && p.canAct) return 'Torna sul ring prima del 10: spingi contro il bordo del ring';
    if (o.state === 'down' && p.canAct && p.pos.distanceTo(o.pos) < 1.4) return o.out ? 'K calcio a terra · fuori dal ring non si schiena' : 'SPAZIO schienamento · K calcio a terra';
    if (o.state === 'rebound' && p.canAct) return 'J Clothesline · K Dropkick!';
    if (p.canAct && this.props.chairNear(p.pos, 0.9)) return 'L prendi la sedia';
    if (p.special >= 100 && p.canAct) return 'SPECIAL pronto: afferra (L) e premi F';
    if (p.canAct && p.pushT > 0) return p.out ? 'Continua a spingere per rientrare sul ring' : 'Continua a spingere per uscire dal ring';
    return '';
  }
}
