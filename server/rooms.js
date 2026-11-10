// Stanze multiplayer via WebSocket (percorso /ws): chi crea la stanza (host) simula l'incontro nel proprio browser,
// l'ospite invia i comandi e riceve lo stato. Il server inoltra soltanto i messaggi.
// Usato dal server di produzione (server.js) e dal server di sviluppo di Vite (vite.config.js).
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const MAX_PEERS = 1;              // ospiti per stanza (oltre all'host): l'incontro è 1 contro 1
const MAX_MSG = 64 * 1024;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const GRACE_MS = 10 * 60 * 1000;  // quanto si aspetta chi è disconnesso prima di toglierlo
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente caratteri ambigui

const send = (ws, msg) => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
const newToken = () => crypto.randomBytes(16).toString('hex');
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// exclusive: le altre richieste di upgrade vengono chiuse (in sviluppo invece restano a Vite)
export function attachRooms(server, { exclusive = false } = {}) {
  const rooms = new Map(); // codice -> stanza
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

  server.on('upgrade', (req, socket, head) => {
    if (!new URL(req.url, 'http://x').pathname.endsWith('/ws')) {
      if (exclusive) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  function newCode() {
    let code;
    do {
      code = Array.from(crypto.randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (rooms.has(code));
    return code;
  }

  function closeRoom(room) {
    clearTimeout(room.hostTimer);
    for (const m of room.members.values()) if (m.ws) { send(m.ws, { t: 'host-left' }); m.ws.room = null; }
    if (room.host) room.host.room = null;
    rooms.delete(room.code);
  }

  // uscita volontaria: l'host chiude la stanza, l'ospite libera il posto
  function leave(ws) {
    const room = rooms.get(ws.room);
    ws.room = null;
    if (!room) return;
    if (room.host === ws) { closeRoom(room); return; }
    const m = room.members.get(ws.id);
    if (m && m.ws === ws) {
      room.members.delete(ws.id);
      send(room.host, { t: 'peer-leave', id: ws.id });
    }
  }

  // connessione caduta: il posto resta riservato per GRACE_MS
  function dropped(ws) {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (room.host === ws) {
      room.host = null;
      for (const m of room.members.values()) send(m.ws, { t: 'host-away' });
      room.hostTimer = setTimeout(() => closeRoom(room), GRACE_MS);
      return;
    }
    const m = room.members.get(ws.id);
    if (m && m.ws === ws) {
      m.ws = null;
      m.awayAt = Date.now();
      send(room.host, { t: 'peer-leave', id: ws.id, away: true });
    }
  }

  wss.on('connection', (ws) => {
    ws.id = crypto.randomBytes(6).toString('hex');
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const room = rooms.get(ws.room);

      switch (m.t) {
        case 'create': {
          leave(ws);
          const code = newCode();
          const token = newToken();
          rooms.set(code, {
            code, host: ws, hostId: ws.id, hostToken: token, hostTimer: null,
            members: new Map(), locked: false, created: Date.now(),
          });
          ws.room = code;
          send(ws, { t: 'created', room: code, id: ws.id, token });
          break;
        }
        case 'join': {
          const target = rooms.get(String(m.room || '').toUpperCase());
          if (!target) { send(ws, { t: 'error', msg: 'Invito non valido o scaduto' }); break; }
          if (target.locked) { send(ws, { t: 'error', msg: "L'incontro è già iniziato" }); break; }
          if (target.members.size >= MAX_PEERS) { send(ws, { t: 'error', msg: 'La stanza è piena' }); break; }
          leave(ws);
          const member = { ws, token: newToken(), awayAt: null };
          target.members.set(ws.id, member);
          ws.room = target.code;
          send(ws, { t: 'joined', room: target.code, id: ws.id, token: member.token, hostAway: !target.host });
          send(target.host, { t: 'peer-join', id: ws.id });
          break;
        }
        case 'resume': {
          // riprende il proprio posto dopo una disconnessione (stesso id, token segreto)
          const target = rooms.get(String(m.room || '').toUpperCase());
          const id = String(m.id || '');
          if (!target) { send(ws, { t: 'error', msg: 'La stanza non esiste più', resume: true }); break; }
          if (id === target.hostId && sameToken(m.token, target.hostToken)) {
            if (target.host && target.host !== ws) { target.host.room = null; target.host.terminate(); }
            clearTimeout(target.hostTimer);
            ws.id = id; ws.room = target.code; target.host = ws;
            send(ws, { t: 'resumed', role: 'host', room: target.code, id });
            for (const [pid, mm] of target.members) if (mm.ws) send(ws, { t: 'peer-join', id: pid, rejoin: true });
            for (const mm of target.members.values()) send(mm.ws, { t: 'host-back' });
            break;
          }
          const member = target.members.get(id);
          if (member && sameToken(m.token, member.token)) {
            if (member.ws && member.ws !== ws) { member.ws.room = null; member.ws.terminate(); }
            ws.id = id; ws.room = target.code;
            member.ws = ws; member.awayAt = null;
            send(ws, { t: 'resumed', role: 'guest', room: target.code, id, hostAway: !target.host });
            send(target.host, { t: 'peer-join', id, rejoin: true });
            break;
          }
          send(ws, { t: 'error', msg: 'Posto nella stanza non più disponibile', resume: true });
          break;
        }
        case 'up': // ospite -> host
          if (room && room.host !== ws) send(room.host, { t: 'up', from: ws.id, d: m.d });
          break;
        case 'down': // host -> ospiti (tutti o uno)
          if (room && room.host === ws) {
            const msg = JSON.stringify({ t: 'down', d: m.d });
            for (const [id, mm] of room.members) {
              if ((!m.to || m.to === id) && mm.ws && mm.ws.readyState === mm.ws.OPEN) mm.ws.send(msg);
            }
          }
          break;
        case 'lock':
          if (room && room.host === ws) room.locked = !!m.v;
          break;
        case 'leave':
          leave(ws);
          break;
      }
    });

    ws.on('close', () => dropped(ws));
  });

  // connessioni morte, posti abbandonati e stanze dimenticate
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.created > ROOM_TTL_MS) { closeRoom(room); continue; }
      for (const [id, m] of room.members) {
        if (!m.ws && m.awayAt && now - m.awayAt > GRACE_MS) {
          room.members.delete(id);
          send(room.host, { t: 'peer-leave', id });
        }
      }
    }
  }, 30_000).unref();

  return wss;
}
