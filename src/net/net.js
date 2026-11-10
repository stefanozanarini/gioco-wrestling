// Client WebSocket per le stanze multiplayer, con ripresa automatica della connessione:
// se il telefono va in secondo piano o cambia rete, al ritorno si rientra nello stesso posto.
const SESSION_KEY = 'bwt-mp-session';
const SESSION_MAX_AGE = 30 * 60 * 1000;

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.token = null;
    this.role = null;
    this.handlers = new Map();
    this.retryTimer = null;
    this.retryDelay = 1000;
    const wake = () => { if (this.room && !this.isOpen()) this.reconnect(true); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    addEventListener('online', wake);
    addEventListener('pageshow', wake);
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, m) { this.handlers.get(type)?.(m); }
  isOpen() { return this.ws?.readyState === 1; }

  connect() {
    if (this.ws && this.ws.readyState <= 1) {
      if (this.ws.readyState === 1) return Promise.resolve();
      return new Promise((resolve, reject) => {
        this.ws.addEventListener('open', () => resolve(), { once: true });
        this.ws.addEventListener('error', () => reject(new Error('Server multiplayer non raggiungibile')), { once: true });
      });
    }
    // percorso relativo: funziona anche se il gioco è pubblicato sotto un sottopercorso
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = '';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'created' || m.t === 'joined' || m.t === 'resumed') {
        this.id = m.id; this.room = m.room;
        if (m.token) this.token = m.token;
        this.role = m.t === 'created' ? 'host' : m.t === 'joined' ? 'guest' : m.role;
        this.retryDelay = 1000;
        this.save();
      }
      if (m.t === 'error' && m.resume) this.forget();
      if (m.t === 'host-left') this.forget();
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.room) { this.emit('reconnecting'); this.scheduleRetry(); }
    };
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Server multiplayer non raggiungibile'));
    });
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.reconnect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.6, 8000);
  }

  async reconnect(now = false) {
    if (!this.room || this.resuming) return;
    if (now) clearTimeout(this.retryTimer);
    this.resuming = true;
    try {
      await this.connect();
      this.send({ t: 'resume', room: this.room, id: this.id, token: this.token });
      this.resuming = false;
    } catch {
      this.resuming = false;
      this.scheduleRetry();
    }
  }

  send(msg) { if (this.isOpen()) this.ws.send(JSON.stringify(msg)); }

  async create() { await this.connect(); this.send({ t: 'create' }); }
  async join(room) { await this.connect(); this.send({ t: 'join', room }); }
  up(d) { this.send({ t: 'up', d }); }
  down(d, to) { this.send({ t: 'down', d, to }); }
  lock(v) { this.send({ t: 'lock', v }); }

  leave() {
    this.send({ t: 'leave' });
    this.forget();
  }

  // sessione salvata nella scheda: permette di riprendere il posto anche dopo un ricaricamento
  save() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ room: this.room, id: this.id, token: this.token, role: this.role, at: Date.now() }));
    } catch { /* ignorato */ }
  }

  forget() {
    clearTimeout(this.retryTimer);
    this.room = null; this.token = null; this.role = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignorato */ }
  }

  savedSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.room && s.token && Date.now() - s.at < SESSION_MAX_AGE) return s;
    } catch { /* ignorato */ }
    return null;
  }

  async resumeSaved(s) {
    this.room = s.room; this.id = s.id; this.token = s.token; this.role = s.role;
    await this.reconnect(true);
  }

  inviteUrl(room) {
    const u = new URL(location.href);
    u.search = `?invito=${room}`;
    u.hash = '';
    return u.toString();
  }
}
