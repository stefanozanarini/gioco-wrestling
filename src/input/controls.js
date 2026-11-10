// Tastiera su PC, joystick virtuale + pulsanti su telefono.
// I pulsanti a schermo premono gli stessi tasti della tastiera (J pugno, K calcio…): il resto del gioco non vede differenze.
export const blankIntent = () => ({
  mx: 0, mz: 0, run: false, punch: false, kick: false, grab: false, block: false,
  pin: false, taunt: false, finisher: false, mash: false,
});

const NO_SCROLL = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const JOY_R = 55;          // raggio del joystick in pixel
const JOY_RUN = 0.92;      // joystick spinto fino in fondo = corsa

export class Controls {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.joy = { x: 0, y: 0, id: null };
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;   // si sta scrivendo (codice della stanza)
      if (NO_SCROLL.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    this.buildTouch();
  }

  buildTouch() {
    const zone = document.getElementById('joy-zone');
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    let ox = 0, oy = 0;
    const move = (t) => {
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
      this.joy.x = dx / JOY_R;
      this.joy.y = dy / JOY_R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    // il joystick compare dove si appoggia il pollice
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joy.id != null) return;
      const t = e.changedTouches[0];
      this.joy.id = t.identifier;
      ox = t.clientX; oy = t.clientY;
      base.style.left = `${ox}px`; base.style.top = `${oy}px`;
      base.classList.add('active');
      move(t);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        this.joy = { x: 0, y: 0, id: null };
        knob.style.transform = '';
        base.classList.remove('active');
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    for (const el of document.querySelectorAll('[data-key]')) {
      const code = el.dataset.key;
      const on = (e) => { e.preventDefault(); this.pressed.add(code); this.down.add(code); el.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.down.delete(code); el.classList.remove('down'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    }
  }

  isDown(...codes) { return codes.some((c) => this.down.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() { this.pressed.clear(); }

  // la telecamera guarda verso -z: W allontana, S avvicina
  intent() {
    const I = blankIntent();
    I.mx = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    I.mz = (this.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (this.isDown('KeyW', 'ArrowUp') ? 1 : 0);
    I.run = this.isDown('ShiftLeft', 'ShiftRight');
    if (this.joy.id != null) {
      const len = Math.hypot(this.joy.x, this.joy.y);
      if (len > 0.25) { I.mx = this.joy.x; I.mz = this.joy.y; I.run = len > JOY_RUN; }
    }
    I.punch = this.wasPressed('KeyJ');
    I.kick = this.wasPressed('KeyK');
    I.grab = this.wasPressed('KeyL');
    I.block = this.isDown('KeyI');
    I.pin = this.wasPressed('Space');
    I.taunt = this.wasPressed('KeyE');
    I.finisher = this.wasPressed('KeyF');
    I.mash = this.wasPressed('Space', 'KeyJ', 'KeyK', 'KeyL');
    return I;
  }
}
