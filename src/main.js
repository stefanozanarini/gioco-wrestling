import './style.css';
import * as THREE from 'three';
import { buildArena } from './game/arena.js';
import { Pipeline } from './game/graphics.js';
import { loadWrestlerModels, WrestlerRig } from './game/wrestlerModel.js';
import { Wrestler, MAT_Y } from './game/wrestler.js';
import { Match } from './game/match.js';
import { AI } from './game/ai.js';
import { Controls, blankIntent } from './input/controls.js';
import { Hud } from './ui/hud.js';
import { Sfx } from './audio/sfx.js';
import { ROSTER, REFEREE, STAFF } from './data/roster.js';
import { Net } from './net/net.js';
import { recorder, mute, snapshot, applySnapshot, smoothFigure, encodeIntent, pressBits, mergeIntent, clearPresses } from './net/sync.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);
const pipeline = new Pipeline(renderer, scene, camera);
addEventListener('resize', () => {
  pipeline.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const arena = buildArena(scene);
const hud = new Hud();
const sfx = new Sfx();
const controls = new Controls();
const fx = {
  shake: (a) => { shake = Math.max(shake, a); },
  rope: (axis, sign) => arena.ropeBounce(axis, sign),
  flash: () => { flash = 1; },
};
let shake = 0, flash = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const KEYS = ROSTER.map((_, i) => [`Digit${i + 1}`, `Numpad${i + 1}`]);
const pressedPick = () => KEYS.findIndex((codes) => controls.wasPressed(...codes));

function card(r, i, cls = '', tag = '') {
  const stats = [`${Math.round(r.height * 100)} cm`, `${r.kg} kg`, r.from].filter(Boolean).join(' · ');
  const photo = portraits[i] ? `<img src="${portraits[i]}" alt="" draggable="false">` : '';
  return `<div class="card ${cls}" data-pick="${i}">${photo}<kbd>${i + 1}</kbd>${tag}<b>${esc(r.name)}</b><small>“${esc(r.nickname)}”</small><small>${esc(stats)}</small></div>`;
}
function titleScreen() {
  const step = pick == null
    ? `Scegli il tuo lottatore: tocca una carta o premi 1–${ROSTER.length}`
    : `Hai scelto ${esc(ROSTER[pick].name)}. Ora l'avversario: 1–${ROSTER.length} · INVIO a caso`;
  return `<div>
    <h1>BWT</h1><h2>Bologna Wrestling Team</h2>
    ${titleNote ? `<p class="err">${esc(titleNote)}</p>` : ''}
    <div class="pick">${ROSTER.map((r, i) => card(r, i, i === pick ? 'picked' : '')).join('')}</div>
    <p class="blink">${step}</p>
    ${pick != null ? '<p><button class="btn big" data-key="Enter">Avversario a caso</button></p>' : ''}
    <p><button class="btn" data-act="online">Gioca online con un amico <kbd>M</kbd></button></p>
  </div>`;
}

hud.overlay('<div><h1>BWT</h1><h2>Bologna Wrestling Team</h2><p>Caricamento lottatori…</p></div>');

// mode: loading | title | online (menu online, attese) | lobby (stanza) | play | paused (solo partita singola)
let mode = 'loading';
let wrestlers, ref, staff, match, ai, p1, p2;
let me;                // lottatore guidato da questo schermo (p1, oppure p2 per l'ospite online)
let pick = null;
let titleNote = '';
let endShown = false;  // schermata di fine incontro visibile
let mpMenu = false;    // menu di pausa online (la partita non si ferma)

async function init() {
  let models;
  try {
    models = await loadWrestlerModels();
  } catch (e) {
    console.error(e);
    hud.overlay(`<div><h1>BWT</h1><p>Impossibile caricare i modelli 3D: ${esc(e.message)}</p></div>`);
    return;
  }
  const make = (look) => new Wrestler(new WrestlerRig(models, look), look);
  wrestlers = ROSTER.map(make);
  ref = make(REFEREE);
  staff = { speaker: make(STAFF.speaker), boss: make(STAFF.boss) };
  for (const w of [...wrestlers, ref, staff.speaker, staff.boss]) scene.add(w.root);
  makePortraits();
  if (import.meta.env.DEV) window.bwtAll = { wrestlers, ref, staff, camera, net, setMode: (m) => { mode = m; }, render: () => pipeline.render(), step: () => step(), portraits, makePortraits };
  startFromUrl();
}

// ritratti dei lottatori per le carte: ogni avatar 3D a braccia conserte, testa e spalle, fotografato una volta al caricamento.
// Si disegna in un angolo della tela del gioco e si copia subito in un'immagine (prima che il browser mostri il fotogramma).
const portraits = [];
function makePortraits(dist = 1.4, lift = -0.05) {
  const W = 240, H = 300;
  const studio = new THREE.Scene();
  const bg = document.createElement('canvas');
  bg.width = 4; bg.height = 256;
  const g = bg.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5a1424'); grad.addColorStop(0.55, '#1a1430'); grad.addColorStop(1, '#0d1a4a');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  studio.background = new THREE.CanvasTexture(bg);
  studio.background.colorSpace = THREE.SRGBColorSpace;
  studio.environment = scene.environment;
  studio.environmentIntensity = 0.35;
  studio.add(new THREE.HemisphereLight('#ffffff', '#3a3040', 1.1));
  const key = new THREE.DirectionalLight('#fff4e6', 3.2);
  key.position.set(1.5, 2.5, 3);
  const rim = new THREE.DirectionalLight('#7fa8ff', 2.4);
  rim.position.set(-2, 1.5, -2.5);
  studio.add(key, rim, key.target, rim.target);
  const cam = new THREE.PerspectiveCamera(28, W / H, 0.1, 20);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  const gl = renderer.domElement, ratio = renderer.getPixelRatio();
  const head = new THREE.Vector3();

  renderer.setScissorTest(true);
  renderer.setScissor(0, 0, W / ratio, H / ratio);
  renderer.setViewport(0, 0, W / ratio, H / ratio);
  wrestlers.forEach((w, i) => {
    const home = w.root.parent;
    studio.add(w.root);
    w.root.visible = true;
    w.reset(0, 0, 0.35);    // leggermente di tre quarti
    w.isStaff = true;       // posa dello staff a riposo: braccia conserte
    for (let k = 0; k < 40; k++) w.update(1 / 30);   // la posa si assesta
    w.isStaff = false;
    w.rig.bones.Head.getWorldPosition(head);
    const tall = w.info.height / 1.85;
    const at = new THREE.Vector3(0, head.y + lift * tall, 0);
    cam.position.set(0.12 * dist / 1.4, at.y + 0.02, dist * tall);
    cam.lookAt(at);
    renderer.render(studio, cam);
    ctx.drawImage(gl, 0, gl.height - H, W, H, 0, 0, W, H);
    portraits[i] = out.toDataURL('image/jpeg', 0.86);
    home.add(w.root);
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

// sul ring restano solo i due lottatori del match (o della schermata iniziale)
function showPair(a, b) {
  wrestlers.forEach((w) => { w.root.visible = w === a || w === b; });
  a.reset(-1.8, 0.9, Math.PI / 2);
  b.reset(1.8, -0.9, -Math.PI / 2);
}

// ring delle schermate: i due lottatori, il presentatore al centro, il dirigente a bordo ring
function stage(a, b) {
  showPair(wrestlers[a], wrestlers[b]);
  ref.reset(0, -2.6, 0);
  staff.speaker.reset(0, 0.4, 0);
  staff.speaker.setState('announce');
  staff.boss.reset(4.9, 5.1, -2.4);
  staff.boss.pos.y = 0;
}

function toTitle(note = '') {
  mode = 'title';
  pick = null;
  match = null;
  titleNote = note;
  endShown = mpMenu = false;
  hud.show(false);
  stage(0, 1);
  hud.overlay(titleScreen());
}

function startMatch(a, b) {
  sfx.ensure();
  p1 = wrestlers[a];
  p2 = wrestlers[b];
  showPair(p1, p2);
  const role = mp?.role;
  me = role === 'guest' ? p2 : p1;
  events.length = 0;
  if (role === 'guest') {
    // l'ospite non simula: la partita serve solo a tenere lo stato ricevuto dall'host
    for (const w of [p1, p2, ref, staff.speaker, staff.boss]) w.net = null;
    match = new Match({ p1, p2, ref, staff, hud: mute, sfx: mute, fx: mute });
  } else if (role === 'host') {
    // l'host registra scritte, suoni e scosse per ripeterli sullo schermo dell'ospite
    match = new Match({
      p1, p2, ref, staff, humans: [p1, p2],
      hud: recorder(hud, 'hud', ['announce', 'count'], events),
      sfx: recorder(sfx, 'sfx', ['hit', 'block', 'slam', 'rope', 'slap', 'bell', 'crowd'], events),
      fx: recorder(fx, 'fx', ['shake', 'rope', 'flash'], events),
    });
  } else match = new Match({ p1, p2, ref, staff, hud, sfx, fx });
  ai = role ? null : new AI(p2, p1, 0.55);
  Object.assign(remote, blankIntent());
  const tu = (w) => (mp && w === me ? `${w.name} (TU)` : w.name);
  hud.setNames(tu(p1), tu(p2));
  hud.overlay('');
  hud.show(true);
  endShown = mpMenu = false;
  mode = 'play';
  if (import.meta.env.DEV) window.bwt = { match, p1, p2, ref, ai, staff, mp };
}

// ---------- multiplayer ----------
// L'host (chi crea la stanza) guida il lottatore rosso e simula l'incontro; l'ospite guida il blu,
// invia i propri comandi e riceve lo stato 25 volte al secondo.
const net = new Net();
let mp = null;          // { role: 'host' | 'guest', room, picks: [host, ospite], guest: ospite presente, away: ospite disconnesso }
const remote = blankIntent();   // comandi dell'ospite (sull'host)
const events = [];              // eventi da inviare all'ospite con il prossimo stato
let lastSnap = 0, lastUp = 0, upBits = 0;
const HOST_AWAY = "L'host si è disconnesso: attendo che rientri…";
const netNote = document.getElementById('netnote');
const setNote = (t) => { netNote.textContent = t || ''; };
const inMatch = () => mode === 'play' && !!match;

function onlineMenu(err = '') {
  mode = 'online';
  hud.show(false);
  hud.overlay(`<div class="mp">
    <h1>BWT</h1><h2>Partita online</h2>
    <p><button class="btn big" data-act="create">Crea una stanza e invita un amico</button></p>
    <p>oppure entra con il codice che hai ricevuto</p>
    <form class="join" data-form="join">
      <input id="mp-code" maxlength="5" placeholder="CODICE" autocomplete="off" spellcheck="false" autocapitalize="characters">
      <button class="btn">Entra</button>
    </form>
    <p class="err">${esc(err)}</p>
    <p><button class="btn ghost" data-act="title">Indietro <kbd>Esc</kbd></button></p>
  </div>`);
}

function waiting(text) {
  mode = 'online';
  hud.show(false);
  hud.overlay(`<div class="mp"><h1>BWT</h1><h2>Partita online</h2><p class="blink">${esc(text)}</p></div>`);
}

async function createRoom() {
  waiting('Creo la stanza…');
  try { await net.create(); } catch (e) { onlineMenu(e.message); }
}

async function joinRoom(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { onlineMenu('Il codice è di 5 caratteri'); return; }
  waiting(`Entro nella stanza ${code}…`);
  try { await net.join(code); } catch (e) { onlineMenu(e.message); }
}

const newMp = (role, room) => ({ role, room, picks: [null, null], guest: role === 'guest', away: false });

function openLobby() {
  mode = 'lobby';
  match = null;
  endShown = mpMenu = false;
  hud.show(false);
  hud.kickBar(null);
  staged = '';
  renderLobby();
}

let staged = '';
function renderLobby() {
  if (mode !== 'lobby' || !mp) return;
  // sul ring i lottatori scelti (o due a caso finché non si sceglie)
  const [hp, gp] = mp.picks;
  const a = hp ?? (gp === 0 ? 1 : 0), b = gp ?? (a === 1 ? 0 : 1);
  if (staged !== `${a}-${b}`) { staged = `${a}-${b}`; stage(a, b); }

  const host = mp.role === 'host';
  const mine = host ? hp : gp, theirs = host ? gp : hp;
  const link = net.inviteUrl(mp.room);
  const text = `${inviteText()} ${link}`;
  const invite = host ? `<div class="invite">
      <code>${esc(link)}</code>
      <button class="btn" data-act="copy">Copia link</button>
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>
      ${navigator.share ? '<button class="btn" data-act="share">Condividi</button>' : ''}
    </div>` : '';
  const who = (i) => esc(ROSTER[i].name);
  const status = host
    ? (!mp.guest ? "In attesa che il tuo amico usi l'invito…"
      : mp.away ? 'Il tuo amico si è disconnesso: attendo che rientri…'
        : theirs == null ? 'Il tuo amico è nella stanza e sta scegliendo il lottatore…' : `Il tuo amico ha scelto <b>${who(theirs)}</b>.`)
    : (theirs == null ? "L'host sta scegliendo il lottatore…" : `L'host ha scelto <b>${who(theirs)}</b>.`);
  const ready = host && mp.guest && !mp.away && hp != null && gp != null;
  const action = host
    ? `<button class="btn big" data-act="start" ${ready ? '' : 'disabled'}>Inizia l'incontro <kbd>INVIO</kbd></button>`
    : `<p class="blink">${mine == null ? `Scegli il tuo lottatore: 1–${ROSTER.length}` : "In attesa che l'host inizi l'incontro…"}</p>`;
  hud.overlay(`<div class="mp">
    <h2>Stanza <b class="code">${esc(mp.room)}</b></h2>
    ${invite}
    <p>${mine == null ? 'Scegli il tuo lottatore' : `Tu sei <b>${who(mine)}</b> (${host ? 'angolo rosso' : 'angolo blu'})`} · ${status}</p>
    <div class="pick">${ROSTER.map((r, i) => card(r, i, i === mine ? 'picked' : i === theirs ? 'taken' : '',
      i === theirs ? '<em>AVVERSARIO</em>' : '')).join('')}</div>
    ${action}
    <p><button class="btn ghost" data-act="leave">Esci dalla stanza</button></p>
  </div>`);
}

const inviteText = () => `Sfidami a BWT, Bologna Wrestling Team! Codice stanza: ${mp.room}`;

// l'host tiene lo stato della stanza e lo inoltra all'ospite
function syncLobby() {
  if (!mp || mp.role !== 'host') return;
  net.down({ k: 'lobby', picks: mp.picks });
  renderLobby();
}

function lobbyPick(i) {
  if (!mp || i < 0 || i >= ROSTER.length) return;
  const host = mp.role === 'host';
  if (i === mp.picks[host ? 1 : 0]) return;   // già preso dall'avversario
  if (host) { mp.picks[0] = i; syncLobby(); }
  else { mp.picks[1] = i; net.up({ k: 'pick', i }); renderLobby(); }
}

function hostStart() {
  const [a, b] = mp.picks;
  if (!mp.guest || mp.away || a == null || b == null) return;
  net.lock(true);
  net.down({ k: 'start', a, b });
  startMatch(a, b);
}

// l'host torna alla stanza (cambio lottatori); l'ospite lo segue
function hostBackToLobby(note = '') {
  net.lock(false);
  openLobby();
  syncLobby();
  setNote(note);
  if (note) setTimeout(() => { if (netNote.textContent === note) setNote(''); }, 5000);
}

function quitOnline(note = '') {
  net.leave();
  mp = null;
  setNote('');
  toTitle(note);
}

net.on('created', (m) => { mp = newMp('host', m.room); openLobby(); });
net.on('joined', (m) => {
  mp = newMp('guest', m.room);
  history.replaceState(null, '', location.pathname);
  setNote(m.hostAway ? HOST_AWAY : '');
  openLobby();
});
net.on('error', (m) => {
  if (m.resume) { mp = null; setNote(''); toTitle(m.msg); return; }   // non è stato possibile riprendere il posto
  if (mode === 'online') onlineMenu(m.msg);
});
net.on('reconnecting', () => setNote('Connessione persa, riconnessione…'));
net.on('resumed', (m) => {
  setNote(m.hostAway ? HOST_AWAY : '');
  if (!mp) {
    // pagina ricaricata: si rientra nella stanza (la partita in corso, se c'era, riparte dalla stanza)
    mp = newMp(m.role, m.room);
    openLobby();
    if (m.role === 'host') syncLobby();
  }
  if (m.role === 'guest') net.up({ k: 'hello' });   // chiede all'host la stanza o la partita in corso
});
net.on('host-away', () => setNote(HOST_AWAY));
net.on('host-back', () => setNote(''));
net.on('host-left', () => {
  mp = null;
  setNote('');
  toTitle("L'host ha chiuso la stanza.");
});

// sull'host: arrivo e uscita dell'ospite
net.on('peer-join', (m) => {
  if (!mp || mp.role !== 'host') return;
  if (!m.rejoin) mp.picks[1] = null;
  mp.guest = true;
  mp.away = false;
  setNote('');
  if (mode === 'lobby') syncLobby();
});
net.on('peer-leave', (m) => {
  if (!mp || mp.role !== 'host') return;
  Object.assign(remote, blankIntent());
  if (m.away) {
    mp.away = true;
    setNote('Il tuo amico si è disconnesso: attendo che rientri…');
    renderLobby();
    return;
  }
  mp.guest = mp.away = false;
  mp.picks[1] = null;
  if (inMatch()) hostBackToLobby('Il tuo amico ha lasciato la partita.');
  else { setNote(''); syncLobby(); }
});

// messaggi ospite -> host: comandi, scelta del lottatore, richiesta di stato dopo un rientro
net.on('up', (m) => {
  if (!mp || mp.role !== 'host') return;
  const d = m.d || {};
  if (d.k === 'i' && Array.isArray(d.i)) { if (inMatch()) mergeIntent(remote, d.i); }
  else if (d.k === 'pick' && mode === 'lobby') {
    const i = d.i | 0;
    if (i >= 0 && i < ROSTER.length && i !== mp.picks[0]) mp.picks[1] = i;
    syncLobby();
  } else if (d.k === 'hello') {
    if (inMatch()) net.down({ k: 'start', a: mp.picks[0], b: mp.picks[1] }, m.from);
    else syncLobby();
  }
});

// messaggi host -> ospite: stanza, avvio, stato dell'incontro
net.on('down', ({ d }) => {
  if (!mp || mp.role !== 'guest' || !d) return;
  switch (d.k) {
    case 'lobby':
      mp.picks = d.picks;
      if (mode !== 'lobby') openLobby();
      else renderLobby();
      break;
    case 'start':
      mp.picks = [d.a, d.b];
      startMatch(d.a, d.b);
      break;
    case 's':
      if (inMatch()) applySnapshot(match, d.s, { hud, sfx, fx });
      break;
  }
});

// link d'invito (?invito=CODICE) o stanza in corso in questa scheda (pagina ricaricata)
function startFromUrl() {
  const invite = new URLSearchParams(location.search).get('invito');
  const saved = net.savedSession();
  if (saved && (!invite || invite.toUpperCase() === saved.room)) {
    waiting('Rientro nella stanza…');
    net.resumeSaved(saved);
    return;
  }
  if (saved) net.forget();
  if (invite) joinRoom(invite);
  else toTitle();
}

// pulsanti e carte delle schermate (mouse e touch)
hud.el.overlay.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act], [data-pick], [data-key]');
  if (!el || el.disabled) return;
  sfx.ensure();
  if (el.dataset.key) { controls.pressed.add(el.dataset.key); return; }   // come premere il tasto
  if (el.dataset.pick != null) {
    const i = Number(el.dataset.pick);
    if (mode === 'title') titlePick(i);
    else if (mode === 'lobby') lobbyPick(i);
    return;
  }
  switch (el.dataset.act) {
    case 'online': onlineMenu(); break;
    case 'title': toTitle(); break;
    case 'create': createRoom(); break;
    case 'start': hostStart(); break;
    case 'leave': quitOnline(); break;
    case 'copy': copyLink(el); break;
    case 'share': navigator.share?.({ title: 'BWT', text: inviteText(), url: net.inviteUrl(mp.room) }).catch(() => {}); break;
  }
});
hud.el.overlay.addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom(document.getElementById('mp-code')?.value);
});

async function copyLink(btn) {
  try {
    await navigator.clipboard.writeText(net.inviteUrl(mp.room));
    btn.textContent = 'Copiato!';
  } catch {
    btn.textContent = 'Copia a mano';
  }
}

// pulsante delle schermate che equivale a un tasto (tocco o clic)
const keyBtn = (code, label, key, cls = '') => `<button class="btn ${cls}" data-key="${code}">${label} <kbd>${key}</kbd></button>`;

function titlePick(n) {
  if (pick == null || n === pick) { pick = n; titleNote = ''; hud.overlay(titleScreen()); }
  else startMatch(pick, n);
}

// ---------- telecamera ----------
const camTarget = new THREE.Vector3(0, MAT_Y + 1, 0);
const tmp = new THREE.Vector3();
function updateCamera(dt, time) {
  if (import.meta.env.DEV && window.bwtCam) { camera.position.fromArray(window.bwtCam.pos); camera.lookAt(...window.bwtCam.at); return; }
  if (mode !== 'play' && mode !== 'paused') {
    // inquadratura lenta attorno al ring nelle schermate
    const a = time * 0.12;
    camera.position.set(Math.sin(a) * 11, 5.5, Math.cos(a) * 11);
    camera.lookAt(0, MAT_Y + 0.8, 0);
    return;
  }
  let mid = tmp.addVectors(p1.pos, p2.pos).multiplyScalar(0.5);
  let sep = p1.pos.distanceTo(p2.pos);
  // a fine incontro l'inquadratura segue il dirigente che sale sul ring
  if (match.outro?.step >= 2) { mid = tmp.copy(staff.boss.pos); sep = 2.5; }
  const k = 1 - Math.exp(-4 * dt);
  camTarget.lerp(new THREE.Vector3(mid.x * 0.85, MAT_Y + 0.85, mid.z * 0.85), k);
  const dist = 5.6 + sep * 0.55;
  const want = new THREE.Vector3(camTarget.x * 0.55, camTarget.y + dist * 0.55, camTarget.z + dist);
  camera.position.lerp(want, 1 - Math.exp(-3 * dt));
  camera.lookAt(camTarget);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    shake *= Math.exp(-6 * dt);
  }
}

// ---------- ciclo ----------
function playStep(dt) {
  const now = performance.now();
  if (mp?.role === 'guest') {
    // l'ospite invia i comandi (i tasti premuti subito, gli altri 20 volte al secondo) e anima lo stato ricevuto
    const I = match.phase === 'over' || mpMenu ? blankIntent() : controls.intent();
    upBits |= pressBits(I);
    if (upBits || now - lastUp > 50) {
      net.up({ k: 'i', i: encodeIntent(I, upBits) });
      upBits = 0;
      lastUp = now;
    }
    for (const w of [p1, p2, ref, staff.speaker, staff.boss]) { smoothFigure(w, dt); w.update(dt); }
    hud.setBars(p1, p2);
  } else {
    const i1 = match.phase === 'over' || mpMenu ? blankIntent() : controls.intent();
    const i2 = mp ? remote : match.phase === 'fight' ? ai.intent(dt) : blankIntent();
    match.update(dt, i1, i2);
    if (mp) {
      clearPresses(remote);   // i tasti premuti dall'ospite valgono una volta sola
      if (now - lastSnap > 40) {
        lastSnap = now;
        if (mp.guest && !mp.away) net.down({ k: 's', s: snapshot(match, events) });
        else events.length = 0;
      }
    }
  }
  hud.prompt(match.promptFor(me, me === p1 ? p2 : p1));
  hud.touchContext(me.state === 'hold', me.special >= 100);
}

// fine incontro: risultato, rivincita (decide l'host) o ritorno al menu / alla stanza
function endStep() {
  const over = match.phase === 'over' && match.outro?.done;
  if (!over) {
    if (endShown) { endShown = false; if (!mpMenu) hud.overlay(''); }   // l'host ha avviato la rivincita
    return;
  }
  const host = mp?.role === 'host', guest = mp?.role === 'guest';
  if (!endShown && !mpMenu) {
    endShown = true;
    const won = match.winner === me;
    const buttons = guest
      ? `<p class="blink">L'host decide la rivincita</p><p>${keyBtn('KeyQ', 'Esci dalla stanza', 'Q', 'ghost')}</p>`
      : `<p>${keyBtn('Enter', 'Rivincita', 'INVIO', 'big')} ${keyBtn('KeyQ', host ? 'Torna alla stanza' : 'Menu', 'Q', 'ghost')}</p>`;
    hud.overlay(`<div><div class="winner">${won ? 'HAI VINTO!' : 'HAI PERSO!'}</div>
      <p>${esc(staff.speaker.name)}: «Vince per schienamento… <b>${esc(match.winner.name)}</b>!»</p>
      ${buttons}</div>`);
  }
  if (!guest && controls.wasPressed('Enter', 'NumpadEnter')) { hud.overlay(''); endShown = false; match.reset(); }
  if (controls.wasPressed('KeyQ')) {
    if (host) hostBackToLobby();
    else if (guest) quitOnline();
    else toTitle();
  }
}

// con la scheda in secondo piano (o la finestra coperta) il browser ferma requestAnimationFrame:
// l'host continua a simulare con un timer in un Worker (rallentato poco), così l'incontro non si blocca per l'ospite
let hiddenLast = 0, frameAt = 0;
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 20)'], { type: 'text/javascript' })));
ticker.onmessage = () => {
  const now = performance.now();
  const dt = Math.min((now - hiddenLast) / 1000, 1 / 30);
  hiddenLast = now;
  if (now - frameAt > 100 && mp?.role === 'host' && inMatch()) playStep(dt);
};

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  frameAt = performance.now();
  step();
}

function step() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const time = clock.elapsedTime;

  if (controls.wasPressed('KeyH')) hud.toggleHelp();
  if (mode === 'title') {
    const n = pressedPick();
    if (n >= 0) titlePick(n);
    else if (controls.wasPressed('KeyM')) onlineMenu();
    else if (pick != null) {
      if (controls.wasPressed('Enter', 'NumpadEnter')) {
        let opp;
        do opp = (Math.random() * ROSTER.length) | 0; while (opp === pick);
        startMatch(pick, opp);
      } else if (controls.wasPressed('Escape', 'Backspace')) { pick = null; hud.overlay(titleScreen()); }
    }
  } else if (mode === 'online') {
    if (controls.wasPressed('Escape') && !mp) toTitle();
  } else if (mode === 'lobby') {
    const n = pressedPick();
    if (n >= 0) lobbyPick(n);
    else if (mp?.role === 'host' && controls.wasPressed('Enter', 'NumpadEnter')) hostStart();
  } else if (mode === 'play') {
    if (controls.wasPressed('Escape', 'KeyP')) {
      if (mp) {
        // online la partita non si ferma: il menu resta sopra il gioco
        mpMenu = !mpMenu;
        hud.overlay(mpMenu ? `<div><h1>BWT</h1><h2>Partita online</h2>
          <p>L'incontro continua anche con il menu aperto.</p>
          <p>${keyBtn('Escape', 'Torna a combattere', 'Esc', 'big')} ${keyBtn('KeyQ', mp.role === 'host' ? 'Torna alla stanza' : 'Esci dalla stanza', 'Q', 'ghost')}</p></div>` : '');
        if (!mpMenu) endShown = false;
      } else {
        mode = 'paused';
        hud.overlay(`<div><h1>BWT</h1><h2>Pausa</h2><p>${keyBtn('Escape', 'Riprendi', 'Esc', 'big')} ${keyBtn('KeyQ', 'Menu', 'Q', 'ghost')}</p></div>`);
      }
    } else if (mpMenu && controls.wasPressed('KeyQ')) {
      if (mp.role === 'host') hostBackToLobby(); else quitOnline();
    }
    if (mode === 'play') {
      playStep(dt);
      if (mode === 'play') endStep();
    }
  } else if (mode === 'paused') {
    if (controls.wasPressed('Escape', 'KeyP')) { mode = 'play'; hud.overlay(''); }
    else if (controls.wasPressed('KeyQ')) toTitle();
  }
  if (wrestlers && mode !== 'play' && mode !== 'paused') {
    for (const w of [...wrestlers, ref, staff.speaker, staff.boss]) if (w.root.visible) w.update(dt);
  }

  arena.update(dt, time, match && mode === 'play' ? match.hype : 0.25);
  updateCamera(dt, time);
  if (flash > 0) {
    renderer.toneMappingExposure = 1 + flash * 1.5;
    flash = Math.max(0, flash - dt * 2.5);
  } else renderer.toneMappingExposure = 1;
  pipeline.render();
  controls.endFrame();
}

init();
frame();
