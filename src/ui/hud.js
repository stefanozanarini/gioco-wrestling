// Barre di energia, scritte a centro schermo, suggerimenti e schermate.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), help: $('help'), announce: $('announce'), count: $('count'), prompt: $('prompt'),
      kick: $('kickbar'), kickFill: $('kickfill'), overlay: $('overlay'), touch: $('touch'),
      name1: $('name1'), name2: $('name2'), hp1: $('hp1'), hp2: $('hp2'), sp1: $('sp1'), sp2: $('sp2'),
    };
    this.lastPrompt = null;
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !on);
    document.body.classList.toggle('playing', on);
    this.el.help.classList.toggle('hidden', !on || this.helpHidden);
    if (!on) { this.prompt(''); this.kickBar(null); }
  }

  toggleHelp() {
    this.helpHidden = !this.helpHidden;
    this.el.help.classList.toggle('hidden', this.helpHidden);
  }

  setNames(a, b) { this.el.name1.textContent = a; this.el.name2.textContent = b; }

  setBars(p1, p2) {
    for (const [w, hp, sp] of [[p1, this.el.hp1, this.el.sp1], [p2, this.el.hp2, this.el.sp2]]) {
      hp.style.width = `${w.hp}%`;
      hp.parentElement.classList.toggle('low', w.hp < 30);
      sp.style.width = `${w.special}%`;
      sp.parentElement.classList.toggle('full', w.special >= 100);
    }
  }

  replay(el, text, cls) {
    el.textContent = text;
    el.className = '';
    void el.offsetWidth; // riavvia l'animazione
    el.className = `show ${cls}`;
  }

  announce(text, cls = '') { this.replay(this.el.announce, text, cls); }
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
