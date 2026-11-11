// Multiplayer: l'host simula l'incontro e invia lo stato (snapshot) con gli eventi del momento
// (scritte, suoni, scosse); l'ospite li applica ai propri personaggi e invia soltanto i comandi.
import * as THREE from 'three';
import { blankIntent } from '../input/controls.js';
import { wrapAngle } from '../game/wrestler.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// oggetto che registra le chiamate a certi metodi (per ripeterle dall'ospite) e poi le esegue
export function recorder(target, name, methods, out) {
  return new Proxy(target, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (!methods.includes(k)) return v.bind(t);
      return (...args) => { out.push([name, k, ...args]); return v.apply(t, args); };
    },
  });
}

// oggetto che accetta qualsiasi chiamata e non fa nulla (la partita dell'ospite non produce effetti da sé)
export const mute = new Proxy({}, { get: () => () => {} });

// ---------- comandi dell'ospite ----------
const PRESS = ['punch', 'kick', 'grab', 'pin', 'taunt', 'finisher', 'mash'];
export const pressBits = (I) => PRESS.reduce((b, k, i) => (I[k] ? b | (1 << i) : b), 0);
export const encodeIntent = (I, bits) => [r2(I.mx), r2(I.mz), I.run ? 1 : 0, I.block ? 1 : 0, bits];

// i tasti tenuti si sovrascrivono, quelli premuti si sommano finché la simulazione non li usa
export function mergeIntent(I, [mx, mz, run, block, bits]) {
  Object.assign(I, { mx: +mx || 0, mz: +mz || 0, run: !!run, block: !!block });
  PRESS.forEach((k, i) => { if (bits & (1 << i)) I[k] = true; });
}
export function clearPresses(I) { for (const k of PRESS) I[k] = false; }
export { blankIntent };

// ---------- stato dei personaggi ----------
function figure(w) {
  const f = w.forced;
  return [r3(w.pos.x), r3(w.pos.y), r3(w.pos.z), r3(w.facing), w.state, w.serial, r3(w.stateTime), r3(w.stateDur),
    r2(w.vel.x), r2(w.vel.z), w.hp, Math.round(w.special),
    f?.tiltX != null ? r3(f.tiltX) : null, f?.lift != null ? r3(f.lift) : null,
    (w.knockAnim ? 1 : 0) | (w.getupAnim ? 2 : 0) | (w.out ? 4 : 0), w.attackSide, r2(w.slap)];
}

function applyFigure(w, a) {
  const [x, y, z, facing, state, serial, st, sd, vx, vz, hp, special, ft, fl, flags, side, slap] = a;
  if (serial !== w.serial) { w.setState(state, sd); w.serial = serial; }
  w.stateTime = st;
  w.stateDur = sd;
  w.knockAnim = !!(flags & 1);
  w.getupAnim = !!(flags & 2);
  w.out = !!(flags & 4);
  w.vel.set(vx, 0, vz);
  w.hp = hp;
  w.special = special;
  w.forced = ft == null && fl == null ? null : { tiltX: ft, lift: fl };
  w.attackSide = side;
  w.slap = slap;
  w.net ??= { pos: new THREE.Vector3(), facing: 0 };
  w.net.pos.set(x, y, z);
  w.net.facing = facing;
  // primo stato o salto troppo grande (rientro, nuova ripresa): niente scivolamento
  if (!w.net.seen || w.pos.distanceToSquared(w.net.pos) > 2.25) { w.pos.copy(w.net.pos); w.facing = facing; }
  w.net.seen = true;
}

// l'ospite avvicina con dolcezza posizione e direzione a quelle ricevute, proseguendo con la velocità nota
export function smoothFigure(w, dt) {
  if (!w.net) return;
  w.net.pos.x += w.vel.x * dt;
  w.net.pos.z += w.vel.z * dt;
  const k = 1 - Math.exp(-14 * dt);
  // w.update() sposterà il personaggio con la sua velocità: qui si corregge solo la differenza
  w.pos.x += (w.net.pos.x - w.vel.x * dt - w.pos.x) * k;
  w.pos.z += (w.net.pos.z - w.vel.z * dt - w.pos.z) * k;
  w.pos.y += (w.net.pos.y - w.pos.y) * k;
  w.facing += wrapAngle(w.net.facing - w.facing) * Math.min(1, 18 * dt);
}

// ---------- incontro ----------
// lottatori (nell'ordine di match.fighters), arbitro e staff
const figures = (match) => [...match.fighters, match.ref, match.staff.speaker, match.staff.boss];

export function snapshot(match, events) {
  const { p2, pin, outro, fighters } = match;
  return {
    f: figures(match).map(figure),
    ph: match.phase,
    hy: r2(match.hype),
    pv: pin ? fighters.indexOf(pin.v) + 1 : 0,
    pa: pin ? fighters.indexOf(pin.a) : -1,
    kb: pin && pin.v === p2 && pin.refReady ? r2(pin.bar) : null,
    o: outro ? [outro.step, outro.done ? 1 : 0, outro.line] : null,
    w: match.winner ? [match.winTeam, fighters.indexOf(match.winner)] : null,
    p: match.props.snapshot(fighters),
    e: events.splice(0),
  };
}

export function applySnapshot(match, s, { hud, sfx, fx }) {
  const { fighters } = match;
  figures(match).forEach((w, i) => s.f[i] && applyFigure(w, s.f[i]));
  match.phase = s.ph;
  match.hype = s.hy;
  match.pin = s.pv ? { v: fighters[s.pv - 1], a: fighters[s.pa] } : null;
  match.outro = s.o ? { step: s.o[0], done: !!s.o[1], line: s.o[2] } : null;
  match.winTeam = s.w ? s.w[0] : null;
  match.winner = s.w ? fighters[s.w[1]] : null;
  match.props.apply(s.p, fighters);
  hud.kickBar(s.kb);
  const targets = { hud, sfx, fx };
  for (const [name, method, ...args] of s.e || []) targets[name]?.[method]?.(...args);
}
