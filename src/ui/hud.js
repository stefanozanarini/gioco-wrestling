// Barre di energia, scritte a centro schermo, suggerimenti e schermate.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), help: $('help'), announce: $('announce'), count: $('count'), prompt: $('prompt'),
      kick: $('kickbar'), kickFill: $('kickfill'), overlay: $('overlay'), touch: $('touch'),
      name1: $('name1'), name2: $('name2'), hp1: $('hp1'), hp2: $('hp2'), sp1: $('sp1'), sp2: $('sp2'),
      name3: $('name3'), name4: $('name4'), hp3: $('hp3'), hp4: $('hp4'), mate1: $('mate1'), mate2: $('mate2'),
      ringout: $('ringout'),
    };
    this.lastPrompt = null;
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !on);
    document.body.classList.toggle('playing', on);
    this.el.help.classList.toggle('hidden', !on || this.helpHidden);
    if (!on) { this.prompt(''); this.kickBar(null); this.ringOut(null); }
  }

  toggleHelp() {
    this.helpHidden = !this.helpHidden;
    this.el.help.classList.toggle('hidden', this.helpHidden);
  }

  // nomi nell'ordine dei lottatori: i due capitani, poi i compagni (2 contro 2)
  setNames(names) {
    const e = this.el;
    [e.name1, e.name2, e.name3, e.name4].forEach((el, i) => { el.textContent = names[i] ?? ''; });
    e.mate1.classList.toggle('hidden', names.length < 3);
    e.mate2.classList.toggle('hidden', names.length < 4);
  }

  setBars(fighters) {
    const e = this.el;
    [[e.hp1, e.sp1], [e.hp2, e.sp2], [e.hp3], [e.hp4]].forEach(([hp, sp], i) => {
      const w = fighters[i];
      if (!w) return;
      hp.style.width = `${w.hp}%`;
      hp.parentElement.classList.toggle('low', w.hp < 30);
      if (!sp) return;
      sp.style.width = `${w.special}%`;
      sp.parentElement.classList.toggle('full', w.special >= 100);
    });
  }

  // conteggio dell'arbitro per chi è fuori dal ring
  ringOut(n) {
    const el = this.el.ringout;
    el.classList.toggle('hidden', n == null);
    if (n != null) el.textContent = `FUORI DAL RING · ${n}`;
  }

  replay(el, text, cls) {
    el.textContent = text;
    el.className = '';
    void el.offsetWidth; // riavvia l'animazione
    el.className = `show ${cls}`;
  }

  announce(text, cls = '') { this.replay(this.el.announce, text, `${cls}${text.length > 22 ? ' long' : ''}`); }
  count(n) { this.replay(this.el.count, String(n), ''); }

  prompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.el.prompt.textContent = text;
  }

  kickBar(v) {
    this.el.kick.classList.toggle('hidden', v == null);
    if (v != null) this.el.kickFill.style.width = `${Math.min(100, v * 100)}%`;
  }

  // pulsanti a schermo: in presa diventano suplex/slam/whip, il finisher si illumina con lo SPECIAL pieno
  touchContext(hold, special) {
    const t = this.el.touch;
    if (t.classList.contains('hold') !== hold) t.classList.toggle('hold', hold);
    if (t.classList.contains('special') !== special) t.classList.toggle('special', special);
  }

  overlay(html) { this.el.overlay.innerHTML = html; }
}
