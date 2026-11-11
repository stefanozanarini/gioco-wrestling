import './style.css';
import * as THREE from 'three';
import { buildArena } from './game/arena.js';
import { Props } from './game/props.js';
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
const props = new Props(scene);
const hud = new Hud();
const sfx = new Sfx();
const controls = new Controls();
const fx = {
  shake: (a) => { shake = Math.max(shake, a); },
  rope: (axis, sign) => arena.ropeBounce(axis, sign),
  flash: () => { flash = 1; },
};
let shake = 0, flash = 0;

const LOGO = '<h1><img src="./img/logo.png" alt="BWT" draggable="false"></h1>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const KEYS = ROSTER.map((_, i) => [`Digit${i + 1}`, `Numpad${i + 1}`]);
const pressedPick = () => KEYS.findIndex((codes) => controls.wasPressed(...codes));

// ruoli nella scelta: 1 contro 1 [tu, avversario]; 2 contro 2 [tu, compagno, avversario, suo compagno]
const ROLES = { 1: ['TU', 'AVVERSARIO'], 2: ['TU', 'COMPAGNO', 'AVVERSARIO', 'AVVERSARIO'] };
const ROLE_ASK = { 1: ['il tuo lottatore', "l'avversario"], 2: ['il tuo lottatore', 'il tuo compagno', 'il primo avversario', 'il secondo avversario'] };

function card(r, i, cls = '', tag = '') {
  const stats = [`${Math.round(r.height * 100)} cm`, `${r.kg} kg`, r.from].filter(Boolean).join(' · ');
  const photo = portraits[i] ? `<img src="${portraits[i]}" alt="" draggable="false">` : '';
  return `<div class="card ${cls}" data-pick="${i}">${photo}<kbd>${i + 1}</kbd>${tag}<b>${esc(r.name)}</b><small>“${esc(r.nickname)}”</small><small>${esc(stats)}</small></div>`;
}
const sizeToggle = (size, act) => `<div class="modes">
    <button class="btn ${size === 1 ? 'on' : ''}" data-act="${act}" data-size="1">1 contro 1</button>
    <button class="btn ${size === 2 ? 'on' : ''}" data-act="${act}" data-size="2">2 contro 2</button> <kbd>T</kbd>
  </div>`;

function titleScreen() {
  const need = teamSize * 2;
  const step = `Scegli ${ROLE_ASK[teamSize][picks.length]}: tocca una carta o premi 1–${ROSTER.length}${picks.length ? ' · INVIO a caso' : ''}`;
  const tag = (i) => (picks.includes(i) ? `<em>${ROLES[teamSize][picks.indexOf(i)]}</em>` : '');
  return `<div>
    ${LOGO}<h2>Bologna Wrestling Team</h2>
    ${titleNote ? `<p class="err">${esc(titleNote)}</p>` : ''}
    ${sizeToggle(teamSize, 'size')}
    <div class="pick">${ROSTER.map((r, i) => card(r, i, picks.includes(i) ? (picks.indexOf(i) < teamSize ? 'picked' : 'taken') : '', tag(i))).join('')}</div>
    <p class="blink">${picks.length < need ? step : ''}</p>
    ${picks.length ? `<p><button class="btn big" data-key="Enter">${picks.length < teamSize ? 'Completa a caso' : 'Avversari a caso'}</button> ${keyBtn('Escape', 'Indietro', 'Esc', 'ghost')}</p>` : ''}
    <p><button class="btn" data-act="online">Gioca online con un amico <kbd>M</kbd></button></p>
  </div>`;
}

hud.overlay(`<div>${LOGO}<h2>Bologna Wrestling Team</h2><p>Caricamento lottatori…</p></div>`);

// mode: loading | title | online (menu online, attese) | lobby (stanza) | play | paused (solo partita singola)
let mode = 'loading';
let wrestlers, ref, staff, match, p1, p2;
let ais = new Map();   // lottatori guidati dal computer -> AI
let me;                // lottatore guidato da questo schermo (p1, oppure p2 per l'ospite online)
let teamSize = 1;      // 1 contro 1 o 2 contro 2
let picks = [];        // scelte nella schermata iniziale (vedi ROLES)
let titleNote = '';
let endShown = false;  // schermata di fine incontro visibile
let mpMenu = false;    // menu di pausa online (la partita non si ferma)

async function init() {
  let models;
  try {
    models = await loadWrestlerModels();
  } catch (e) {
    console.error(e);
    hud.overlay(`<div>${LOGO}<p>Impossibile caricare i modelli 3D: ${esc(e.message)}</p></div>`);
    return;
  }
  const make = (look) => new Wrestler(new WrestlerRig(models, look), look);
  wrestlers = ROSTER.map(make);
  ref = make(REFEREE);
  staff = { speaker: make(STAFF.speaker), boss: make(STAFF.boss) };
  for (const w of [...wrestlers, ref, staff.speaker, staff.boss]) scene.add(w.root);
  makePortraits();
  if (import.meta.env.DEV) window.bwtAll = { wrestlers, ref, staff, camera, net, props, setMode: (m) => { mode = m; }, render: () => pipeline.render(), step: () => step(), portraits, makePortraits };
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

// sul ring restano solo i lottatori del match (o della schermata iniziale): [squadra rossa, squadra blu]
function showTeams(teams) {
  const on = new Set(teams.flat());
  wrestlers.forEach((w) => { w.root.visible = on.has(w); });
  const spots = [[[-1.8, 0.9], [-2.4, -1.6]], [[1.8, -0.9], [2.4, 1.6]]];
  teams.forEach((t, k) => t.forEach((w, j) => w.reset(...spots[k][j], k ? -Math.PI / 2 : Math.PI / 2)));
}

// ring delle schermate: i lottatori scelti, il presentatore al centro, il dirigente a bordo ring
function stage(teams) {
  if (match) for (const w of match.fighters) if (w.carry) props.drop(w);
  props.reset();
  showTeams(teams.map((t) => t.map((i) => wrestlers[i])));
  ref.reset(0, -2.6, 0);
  staff.speaker.reset(0, 0.4, 0);
  staff.speaker.setState('announce');
  staff.boss.reset(4.9, 5.1, -2.4);
  staff.boss.pos.y = 0;
}

function toTitle(note = '') {
  mode = 'title';
  picks = [];
  stage([[0], [1]]);
  match = null;
  titleNote = note;
  endShown = mpMenu = false;
  hud.show(false);
  hud.overlay(titleScreen());
}

// teams: indici del roster [[rosso, compagno?], [blu, compagno?]]
function startMatch(teams) {
  sfx.ensure();
  if (match) for (const w of match.fighters) if (w.carry) props.drop(w);
  const T = teams.map((t) => t.map((i) => wrestlers[i]));
  [[p1], [p2]] = T;
  showTeams(T);
  const role = mp?.role;
  me = role === 'guest' ? p2 : p1;
  events.length = 0;
  if (role === 'guest') {
    // l'ospite non simula: la partita serve solo a tenere lo stato ricevuto dall'host
    for (const w of [...T.flat(), ref, staff.speaker, staff.boss]) w.net = null;
    match = new Match({ teams: T, ref, staff, props, hud: mute, sfx: mute, fx: mute });
  } else if (role === 'host') {
    // l'host registra scritte, suoni e scosse per ripeterli sullo schermo dell'ospite
    match = new Match({
      teams: T, ref, staff, props, humans: [p1, p2],
      hud: recorder(hud, 'hud', ['announce', 'count', 'ringOut'], events),
      sfx: recorder(sfx, 'sfx', ['hit', 'block', 'slam', 'rope', 'slap', 'bell', 'crowd'], events),
      fx: recorder(fx, 'fx', ['shake', 'rope', 'flash'], events),
    });
  } else match = new Match({ teams: T, ref, staff, props, hud, sfx, fx });
  // il computer guida tutti tranne le persone (sull'ospite non serve: simula l'host)
  ais = new Map();
  if (role !== 'guest') for (const w of match.fighters) if (w !== p1 && !(role && w === p2)) ais.set(w, new AI(w, match, w.team === 0 ? 0.6 : 0.55));
  Object.assign(remote, blankIntent());
  const tu = (w) => (w === me ? `${w.name} (TU)` : w.team === me.team ? `${w.name} (CPU)` : w.name);
  hud.setNames(match.fighters.map(tu));
  hud.overlay('');
  hud.show(true);
  endShown = mpMenu = false;
  mode = 'play';
  if (import.meta.env.DEV) window.bwt = { match, p1, p2, ref, ais, staff, mp, props };
}

// ---------- multiplayer ----------
// L'host (chi crea la stanza) guida il lottatore rosso e simula l'incontro; l'ospite guida il blu,
// invia i propri comandi e riceve lo stato 25 volte al secondo.
const net = new Net();
let mp = null;          // { role: 'host' | 'guest', room, size, picks: [[host, compagno?], [ospite, compagno?]], guest: ospite presente, away: ospite disconnesso }
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
    ${LOGO}<h2>Partita online</h2>
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
  hud.overlay(`<div class="mp">${LOGO}<h2>Partita online</h2><p class="blink">${esc(text)}</p></div>`);
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

const newMp = (role, room) => ({ role, room, size: 1, picks: [[], []], guest: role === 'guest', away: false });
const full = (l) => l.length === mp.size;

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
  // sul ring i lottatori scelti (o i primi liberi finché non si sceglie)
  const [hp, gp] = mp.picks;
  const free = ROSTER.map((_, i) => i).filter((i) => !hp.includes(i) && !gp.includes(i));
  const fill = (l) => [...l, ...free.splice(0, Math.max(0, mp.size - l.length))].slice(0, mp.size);
  const T = [fill(hp), fill(gp)];
  if (staged !== JSON.stringify(T)) { staged = JSON.stringify(T); stage(T); }

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
  const who = (l) => l.map((i) => `<b>${esc(ROSTER[i].name)}</b>`).join(' e ');
  const what = mp.size === 2 ? 'i lottatori' : 'il lottatore';
  const status = host
    ? (!mp.guest ? "In attesa che il tuo amico usi l'invito…"
      : mp.away ? 'Il tuo amico si è disconnesso: attendo che rientri…'
        : !full(theirs) ? `Il tuo amico è nella stanza e sta scegliendo ${what}…` : `Il tuo amico ha scelto ${who(theirs)}.`)
    : (!full(theirs) ? `L'host sta scegliendo ${what}…` : `L'host ha scelto ${who(theirs)}.`);
  const ready = host && mp.guest && !mp.away && full(hp) && full(gp);
  const ask = mp.size === 2 ? (mine.length ? 'il tuo compagno (lo guida il computer)' : 'il tuo lottatore') : 'il tuo lottatore';
  const action = host
    ? `<button class="btn big" data-act="start" ${ready ? '' : 'disabled'}>Inizia l'incontro <kbd>INVIO</kbd></button>`
    : `<p class="blink">${!full(mine) ? `Scegli ${ask}: 1–${ROSTER.length}` : "In attesa che l'host inizi l'incontro…"}</p>`;
  const tag = (i) => (mine.includes(i) ? `<em>${mine.indexOf(i) ? 'COMPAGNO' : 'TU'}</em>` : theirs.includes(i) ? '<em>AVVERSARIO</em>' : '');
  hud.overlay(`<div class="mp">
    <h2>Stanza <b class="code">${esc(mp.room)}</b></h2>
    ${invite}
    ${host ? sizeToggle(mp.size, 'mpsize') : `<p>Incontro <b>${mp.size} contro ${mp.size}</b></p>`}
    <p>${!full(mine) ? `Scegli ${ask}` : `Tu sei ${who(mine)} (${host ? 'angolo rosso' : 'angolo blu'})`} · ${status}</p>
    <div class="pick">${ROSTER.map((r, i) => card(r, i, mine.includes(i) ? 'picked' : theirs.includes(i) ? 'taken' : '', tag(i))).join('')}</div>
    ${action}
    <p><button class="btn ghost" data-act="leave">Esci dalla stanza</button></p>
  </div>`);
}

const inviteText = () => `Sfidami a BWT, Bologna Wrestling Team! Codice stanza: ${mp.room}`;

// l'host tiene lo stato della stanza e lo inoltra all'ospite
function syncLobby() {
  if (!mp || mp.role !== 'host') return;
  net.down({ k: 'lobby', picks: mp.picks, size: mp.size });
  renderLobby();
}

// scelta nella stanza: si aggiunge alla propria squadra; toccando un proprio lottatore lo si toglie
function choose(list, other, i, size) {
  if (other.includes(i)) return list;   // già preso dall'avversario
  if (list.includes(i)) return list.filter((x) => x !== i);
  return list.length < size ? [...list, i] : [...list.slice(0, size - 1), i];
}

function lobbyPick(i) {
  if (!mp || i < 0 || i >= ROSTER.length) return;
  const host = mp.role === 'host';
  const k = host ? 0 : 1;
  mp.picks[k] = choose(mp.picks[k], mp.picks[1 - k], i, mp.size);
  if (host) syncLobby();
  else { net.up({ k: 'pick', l: mp.picks[1] }); renderLobby(); }
}

function setLobbySize(n) {
  if (!mp || mp.role !== 'host' || mp.size === n) return;
  mp.size = n;
  mp.picks = mp.picks.map((l) => l.slice(0, n));
  syncLobby();
}

function hostStart() {
  if (!mp.guest || mp.away || !full(mp.picks[0]) || !full(mp.picks[1])) return;
  net.lock(true);
  net.down({ k: 'start', teams: mp.picks });
  startMatch(mp.picks);
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
  if (!m.rejoin) mp.picks[1] = [];
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
  mp.picks[1] = [];
  if (inMatch()) hostBackToLobby('Il tuo amico ha lasciato la partita.');
  else { setNote(''); syncLobby(); }
});

// messaggi ospite -> host: comandi, scelta del lottatore, richiesta di stato dopo un rientro
net.on('up', (m) => {
  if (!mp || mp.role !== 'host') return;
  const d = m.d || {};
  if (d.k === 'i' && Array.isArray(d.i)) { if (inMatch()) mergeIntent(remote, d.i); }
  else if (d.k === 'pick' && mode === 'lobby') {
    const l = Array.isArray(d.l) ? [...new Set(d.l.map((x) => x | 0))] : [];
    if (l.length <= mp.size && l.every((i) => i >= 0 && i < ROSTER.length && !mp.picks[0].includes(i))) mp.picks[1] = l;
    syncLobby();
  } else if (d.k === 'hello') {
    if (inMatch()) net.down({ k: 'start', teams: mp.picks }, m.from);
    else syncLobby();
  }
});

// messaggi host -> ospite: stanza, avvio, stato dell'incontro
net.on('down', ({ d }) => {
  if (!mp || mp.role !== 'guest' || !d) return;
  switch (d.k) {
    case 'lobby':
      mp.picks = d.picks;
      mp.size = d.size;
      if (mode !== 'lobby') openLobby();
      else renderLobby();
      break;
    case 'start':
      mp.picks = d.teams;
      mp.size = d.teams[0].length;
      startMatch(d.teams);
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
    case 'size': setTitleSize(Number(el.dataset.size)); break;
    case 'mpsize': setLobbySize(Number(el.dataset.size)); break;
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

function setTitleSize(n) {
  teamSize = n;
  picks = picks.slice(0, n === 1 ? 1 : picks.length);
  titleNote = '';
  hud.overlay(titleScreen());
}

function titlePick(n) {
  if (picks.includes(n)) picks = picks.slice(0, picks.indexOf(n));   // ritocca la scelta
  picks.push(n);
  titleNote = '';
  if (picks.length === teamSize * 2) startTitleMatch();
  else hud.overlay(titleScreen());
}

// completa a caso le scelte mancanti e inizia
function startTitleMatch() {
  const free = ROSTER.map((_, i) => i).filter((i) => !picks.includes(i)).sort(() => Math.random() - 0.5);
  while (picks.length < teamSize * 2) picks.push(free.pop());
  startMatch([picks.slice(0, teamSize), picks.slice(teamSize)]);
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
  // inquadra tutti i lottatori (anche fuori dal ring)
  const F = match.fighters;
  let mid = tmp.set(0, 0, 0);
  for (const w of F) mid.add(w.pos);
  mid.multiplyScalar(1 / F.length);
  let sep = 0;
  for (const w of F) sep = Math.max(sep, 2 * Math.hypot(w.pos.x - mid.x, w.pos.z - mid.z));
  // a fine incontro l'inquadratura segue il dirigente che sale sul ring
  if (match.outro?.step >= 2) { mid = tmp.copy(staff.boss.pos); sep = 2.5; }
  const k = 1 - Math.exp(-4 * dt);
  camTarget.lerp(new THREE.Vector3(mid.x * 0.85, Math.max(mid.y, 0.3) + 0.85, mid.z * 0.85), k);
  const dist = 5.6 + sep * 0.55 + (F.some((w) => w.out) ? 1.2 : 0);   // fuori dal ring si allarga l'inquadratura
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
    for (const w of [...match.fighters, ref, staff.speaker, staff.boss]) { smoothFigure(w, dt); w.update(dt); }
    props.update(dt);
    hud.setBars(match.fighters);
  } else {
    const mine = match.phase === 'over' || mpMenu ? blankIntent() : controls.intent();
    // (sviluppo: window.bwtAuto fa giocare anche il proprio lottatore al computer)
    if (import.meta.env.DEV && window.bwtAuto && !ais.has(p1)) ais.set(p1, new AI(p1, match, 0.6));
    const auto = import.meta.env.DEV && window.bwtAuto;
    const intents = match.fighters.map((w) => (w === p1 && !auto ? mine : mp && w === p2 ? remote
      : match.phase === 'fight' ? ais.get(w).intent(dt) : blankIntent()));
    match.update(dt, intents);
    if (mp) {
      clearPresses(remote);   // i tasti premuti dall'ospite valgono una volta sola
      if (now - lastSnap > 40) {
        lastSnap = now;
        if (mp.guest && !mp.away) net.down({ k: 's', s: snapshot(match, events) });
        else events.length = 0;
      }
    }
  }
  hud.prompt(match.promptFor(me));
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
    const won = match.winTeam === me.team;
    const how = match.howWon === 'countout' ? 'per count-out' : 'per schienamento';
    const winners = match.tag ? match.teams[match.winTeam].map((w) => w.name).join(' e ') : match.winner.name;
    const buttons = guest
      ? `<p class="blink">L'host decide la rivincita</p><p>${keyBtn('KeyQ', 'Esci dalla stanza', 'Q', 'ghost')}</p>`
      : `<p>${keyBtn('Enter', 'Rivincita', 'INVIO', 'big')} ${keyBtn('KeyQ', host ? 'Torna alla stanza' : 'Menu', 'Q', 'ghost')}</p>`;
    hud.overlay(`<div><div class="winner">${won ? 'HAI VINTO!' : 'HAI PERSO!'}</div>
      <p>${esc(staff.speaker.name)}: «${match.tag ? 'Vincono' : 'Vince'} ${how}… <b>${esc(winners)}</b>!»</p>
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
    else if (controls.wasPressed('KeyT')) setTitleSize(teamSize === 1 ? 2 : 1);
    else if (picks.length) {
      if (controls.wasPressed('Enter', 'NumpadEnter')) startTitleMatch();
      else if (controls.wasPressed('Escape', 'Backspace')) { picks.pop(); hud.overlay(titleScreen()); }
    }
  } else if (mode === 'online') {
    if (controls.wasPressed('Escape') && !mp) toTitle();
  } else if (mode === 'lobby') {
    const n = pressedPick();
    if (n >= 0) lobbyPick(n);
    else if (mp?.role === 'host' && controls.wasPressed('Enter', 'NumpadEnter')) hostStart();
    else if (mp?.role === 'host' && controls.wasPressed('KeyT')) setLobbySize(mp.size === 1 ? 2 : 1);
  } else if (mode === 'play') {
    if (controls.wasPressed('Escape', 'KeyP')) {
      if (mp) {
        // online la partita non si ferma: il menu resta sopra il gioco
        mpMenu = !mpMenu;
        hud.overlay(mpMenu ? `<div>${LOGO}<h2>Partita online</h2>
          <p>L'incontro continua anche con il menu aperto.</p>
          <p>${keyBtn('Escape', 'Torna a combattere', 'Esc', 'big')} ${keyBtn('KeyQ', mp.role === 'host' ? 'Torna alla stanza' : 'Esci dalla stanza', 'Q', 'ghost')}</p></div>` : '');
        if (!mpMenu) endShown = false;
      } else {
        mode = 'paused';
        hud.overlay(`<div>${LOGO}<h2>Pausa</h2><p>${keyBtn('Escape', 'Riprendi', 'Esc', 'big')} ${keyBtn('KeyQ', 'Menu', 'Q', 'ghost')}</p></div>`);
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
