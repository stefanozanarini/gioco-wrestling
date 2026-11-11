// Arena BWT: ring con corde rossoblù, rampa d'ingresso, maxischermo, tribune con pubblico animato.
import * as THREE from 'three';
import { MAT_Y } from './wrestler.js';

const RED = '#c8102e', BLUE = '#1d3f9a', GOLD = '#f5c518';
const POST = 3.85;                       // distanza dei pali dal centro
const ROPE_H = [0.52, 0.94, 1.36];       // altezze delle corde sopra il tappeto
const ROPE_COLORS = [RED, '#f2f2f2', BLUE];

// logo BWT (bianco su trasparente, da tools/logo-bwt.png): le texture che lo usano si ridisegnano appena è caricato
const LOGO = new Image();
const withLogo = [];
LOGO.onload = () => { for (const redraw of withLogo) redraw(); };
LOGO.src = './img/logo.png';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const paint = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  paint();
  withLogo.push(paint);
  return t;
}

// disegna il logo largo `width`, centrato in (x, y)
function logoImage(g, x, y, width) {
  if (!LOGO.complete || !LOGO.naturalWidth) return;
  const h = width * LOGO.naturalHeight / LOGO.naturalWidth;
  g.drawImage(LOGO, x - width / 2, y - h / 2, width, h);
}

function logo(g, x, y, r) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); g.fillStyle = RED; g.fill();
  g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); g.fillStyle = BLUE; g.fill();
  g.lineWidth = r * 0.07; g.strokeStyle = '#fff'; g.beginPath(); g.arc(0, 0, r * 0.94, 0, Math.PI * 2); g.stroke();
  logoImage(g, 0, -r * 0.1, r * 1.45);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${r * 0.11}px system-ui, sans-serif`;
  g.fillText('BOLOGNA WRESTLING TEAM', 0, r * 0.66);
  g.restore();
}

export function buildArena(scene) {
  scene.background = new THREE.Color('#06060c');
  scene.fog = new THREE.Fog('#06060c', 22, 48);

  // luci: un faro principale sul ring, luci colorate sulle tribune
  scene.add(new THREE.HemisphereLight('#6070c0', '#140a0a', 0.35));
  const key = new THREE.SpotLight('#fff4e6', 760, 0, Math.PI / 5.2, 0.6, 2);
  key.position.set(0, 13, 2);
  key.target.position.set(0, MAT_Y, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 6; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#ffe8d0', 0.5);
  fill.position.set(-6, 8, 10);
  scene.add(fill);
  const crowdLights = [];
  [[RED, -12, 6], [BLUE, 12, 6], [RED, 12, -6], [BLUE, -12, -6]].forEach(([col, x, z]) => {
    const s = new THREE.SpotLight(col, 400, 0, Math.PI / 4, 0.6, 2);
    s.position.set(x * 0.3, 11, z * 0.3);
    s.target.position.set(x, 2, z);
    scene.add(s, s.target);
    crowdLights.push(s);
  });

  // pavimento e materassini protettivi attorno al ring
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: '#101016', roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const pads = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: '#16235a', roughness: 0.8 }));
  pads.rotation.x = -Math.PI / 2; pads.position.y = 0.01; pads.receiveShadow = true;
  scene.add(pads);

  // ring
  const matTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#d6d0c2'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.05;
    for (let i = 0; i < 6000; i++) { g.fillStyle = Math.random() < 0.6 ? '#000' : '#fff'; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2); }
    // segni di scarpe e sudore al centro
    g.globalAlpha = 0.035; g.fillStyle = '#3a3020';
    for (let i = 0; i < 260; i++) { const a = Math.random() * 6.28, r = Math.random() * 380; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 8 + Math.random() * 26, 4 + Math.random() * 10, a, 0, 6.28); g.fill(); }
    g.globalAlpha = 1;
    g.lineWidth = 10; g.strokeStyle = BLUE; g.strokeRect(30, 30, w - 60, h - 60);
    logo(g, w / 2, h / 2, 230);
  });
  const skirtTex = canvasTex(1024, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, RED); grd.addColorStop(0.5, '#300810'); grd.addColorStop(1, BLUE);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = GOLD; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    logoImage(g, w * 0.2, h / 2, 130);
    g.font = '800 34px system-ui, sans-serif';
    g.fillText('BOLOGNA WRESTLING TEAM', w * 0.62, h / 2);
  });
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(8.1, MAT_Y - 0.06, 8.1), new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.7 }));
  skirt.position.y = (MAT_Y - 0.06) / 2;
  skirt.receiveShadow = true;
  scene.add(skirt);
  const edge = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.8 });
  const weave = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8080ff'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? '#7f88ff' : '#8078ff'; g.fillRect(0, y, w, 2); }
    for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? '#887fff' : '#787fff'; g.globalAlpha = 0.6; g.fillRect(x, 0, 2, h); }
  });
  weave.colorSpace = THREE.NoColorSpace;
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(10, 10);
  const matTop = new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9, normalMap: weave, normalScale: new THREE.Vector2(0.35, 0.35) });
  const mat = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 8.2), [edge, edge, matTop, edge, edge, edge]);
  mat.position.y = MAT_Y - 0.04;
  mat.receiveShadow = true;
  scene.add(mat);

  // pali, angoli imbottiti e corde
  const steel = new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.85, roughness: 0.3 });
  const corners = [[1, 1, RED], [-1, -1, BLUE], [1, -1, '#eeeeee'], [-1, 1, '#eeeeee']];
  for (const [sx, sz, col] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, MAT_Y + 1.6, 12), steel);
    post.position.set(sx * POST, (MAT_Y + 1.6) / 2, sz * POST);
    post.castShadow = true;
    scene.add(post);
    const padMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 });
    for (const h of ROPE_H) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), padMat);
      pad.position.set(sx * (POST - 0.08), MAT_Y + h, sz * (POST - 0.08));
      pad.rotation.y = Math.PI / 4;
      scene.add(pad);
    }
  }
  const ropes = { 'x+': [], 'x-': [], 'z+': [], 'z-': [] };
  ROPE_H.forEach((h, i) => {
    const m = new THREE.MeshStandardMaterial({ color: ROPE_COLORS[i], roughness: 0.3, metalness: 0.05 });
    for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, POST * 2, 16), m);
      rope.castShadow = true;
      if (axis === 'x') { rope.rotation.x = Math.PI / 2; rope.position.set(sign * POST, MAT_Y + h, 0); }
      else { rope.rotation.z = Math.PI / 2; rope.position.set(0, MAT_Y + h, sign * POST); }
      rope.userData.base = rope.position.clone();
      scene.add(rope);
      ropes[`${axis}${sign > 0 ? '+' : '-'}`].push(rope);
    }
  });
  const ropeAmp = { 'x+': 0, 'x-': 0, 'z+': 0, 'z-': 0 };

  // transenne
  const barMat = new THREE.MeshStandardMaterial({ color: '#202030', roughness: 0.6 });
  const stripMat = new THREE.MeshStandardMaterial({ color: BLUE, emissive: BLUE, emissiveIntensity: 0.6 });
  for (const [x, z, w, d] of [[0, 7.5, 15, 0.1], [7.5, 0, 0.1, 15], [-7.5, 0, 0.1, 15], [-4.6, -7.5, 5.8, 0.1], [4.6, -7.5, 5.8, 0.1]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), barMat);
    b.position.set(x, 0.55, z);
    scene.add(b);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), stripMat);
    s.position.set(x, 1.08, z);
    scene.add(s);
  }

  // rampa d'ingresso e maxischermo
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 11), new THREE.MeshStandardMaterial({ color: '#15151f', roughness: 0.5, metalness: 0.3 }));
  ramp.position.set(0, 0.25, -12.5);
  ramp.receiveShadow = true;
  scene.add(ramp);
  const screenTex = canvasTex(1024, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, RED); grd.addColorStop(1, BLUE);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    logo(g, w / 2, h / 2, 210);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 6.5, -18.2);
  scene.add(screen);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(12.6, 6.6, 0.3), new THREE.MeshStandardMaterial({ color: '#0a0a10' }));
  frame.position.set(0, 6.5, -18.4);
  scene.add(frame);

  // americana delle luci sopra il ring
  const truss = new THREE.MeshStandardMaterial({ color: '#333', metalness: 0.7, roughness: 0.4 });
  for (const [x, z, w, d] of [[0, 4.5, 9.2, 0.25], [0, -4.5, 9.2, 0.25], [4.5, 0, 0.25, 9.2], [-4.5, 0, 0.25, 9.2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), truss);
    b.position.set(x, 9, z);
    scene.add(b);
  }

  // fari appesi all'americana: lente accesa (fa bagliore) e fascio di luce nella foschia
  const lampMat = new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.6, roughness: 0.4 });
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d8').multiplyScalar(4) });
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color('#ffe9c8') }, uStrength: { value: 0.07 } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV;
void main() { vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uStrength; varying float vH; varying vec3 vN; varying vec3 vV;
void main() { float edge = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(uCol * uStrength * edge * smoothstep(0.0, 1.0, vH), 1.0); }`,
  });
  const beamLen = 9 - MAT_Y;
  const beamGeo = new THREE.CylinderGeometry(0.12, 1.5, beamLen, 24, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const k of [0.45, 0.85]) {
    const x = sx * 4.5, z = sz * 4.5 * k;
    for (const [lx, lz] of [[x, z], [z, x]]) {
      const lamp = new THREE.Group();
      lamp.position.set(lx, 8.75, lz);
      lamp.lookAt(lx * 0.25, MAT_Y, lz * 0.25);
      lamp.rotateX(-Math.PI / 2);   // l'asse -Y della lampada punta al ring
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.35, 12), lampMat);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), lensMat);
      lens.position.y = -0.18; lens.rotation.x = Math.PI / 2;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = -0.18;
      lamp.add(can, lens, beam);
      scene.add(lamp);
    }
  }

  // strisce LED sul bordo del ring
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(BLUE).multiplyScalar(2.5) });
  for (const [w, d, x, z] of [[8.14, 0.03, 0, 4.06], [8.14, 0.03, 0, -4.06], [0.03, 8.14, 4.06, 0], [0.03, 8.14, -4.06, 0]]) {
    for (const y of [MAT_Y - 0.12, 0.08]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), led);
      strip.position.set(x, y, z);
      scene.add(strip);
    }
  }

  // tribune e pubblico (instanced): gradoni su quattro lati, lasciando libero il corridoio della rampa
  const seats = [];
  const stepMat = new THREE.MeshStandardMaterial({ color: '#1a1a24', roughness: 0.9 });
  for (let row = 0; row < 12; row++) {
    const d = 8.6 + row * 0.85, y = row * 0.45;
    for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 0.85 : d * 2, y + 0.3, axis === 'x' ? d * 2 : 0.85), stepMat);
      step.position.set(axis === 'x' ? sign * d : 0, (y + 0.3) / 2, axis === 'z' ? sign * d : 0);
      scene.add(step);
      for (let u = -d + 0.4; u < d - 0.3; u += 0.62) {
        if (axis === 'z' && sign < 0 && Math.abs(u) < 2.6) continue;
        if (Math.random() < 0.1) continue;
        const x = axis === 'x' ? sign * d : u, z = axis === 'z' ? sign * d : u;
        seats.push({ x: x + (Math.random() - 0.5) * 0.12, y: y + 0.3, z, ph: Math.random() * 6.28, f: 4 + Math.random() * 4 });
      }
    }
  }
  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.34, 3, 8);
  bodyGeo.scale(1, 1, 0.75);
  bodyGeo.translate(0, 0.36, 0);
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
  headGeo.translate(0, 0.76, 0);
  const crowdBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), seats.length);
  const crowdHead = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), seats.length);
  const shirts = ['#7a0a1c', '#16306e', '#9a9aa0', '#1c1c1c', '#8a6f10', '#4a0c16', '#203f8a', '#3a3a3a'];
  const skins = ['#f1c9a5', '#d9a77f', '#a8714a', '#6b4429', '#f6d7bd'];
  const col = new THREE.Color();
  seats.forEach((s, i) => {
    crowdBody.setColorAt(i, col.set(shirts[(Math.random() * shirts.length) | 0]));
    crowdHead.setColorAt(i, col.set(skins[(Math.random() * skins.length) | 0]));
  });
  scene.add(crowdBody, crowdHead);
  const m4 = new THREE.Matrix4();

  // flash delle macchine fotografiche: punti che si accendono per un attimo, più spesso quando l'eccitazione sale
  const NF = 60;
  const flashPos = new Float32Array(NF * 3), flashCol = new Float32Array(NF * 3), flashT = new Float32Array(NF);
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
  const dot = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, '#fff'); r.addColorStop(0.25, '#fff'); r.addColorStop(1, '#0000');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const flashes = new THREE.Points(flashGeo, new THREE.PointsMaterial({
    size: 0.9, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashes.frustumCulled = false;
  scene.add(flashes);

  return {
    // il pubblico salta e ondeggia di più quando l'eccitazione (hype 0-1) sale
    update(dt, time, hype) {
      const amp = 0.03 + hype * 0.22;
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const b = Math.max(0, Math.sin(time * s.f + s.ph)) * amp;
        m4.makeTranslation(s.x, s.y + b, s.z);
        crowdBody.setMatrixAt(i, m4);
        crowdHead.setMatrixAt(i, m4);
      }
      crowdBody.instanceMatrix.needsUpdate = true;
      crowdHead.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NF; i++) {
        flashT[i] -= dt;
        if (flashT[i] <= 0 && Math.random() < dt * (0.15 + hype * 1.5)) {
          const s = seats[(Math.random() * seats.length) | 0];
          flashPos.set([s.x, s.y + 0.85, s.z], i * 3);
          flashT[i] = 0.12;
        }
        const v = Math.max(0, flashT[i] / 0.12) * 3;
        flashCol.set([v, v, v], i * 3);
      }
      flashGeo.attributes.position.needsUpdate = true;
      flashGeo.attributes.color.needsUpdate = true;
      crowdLights.forEach((l, i) => { l.intensity = 250 + 250 * hype + 80 * Math.sin(time * 1.3 + i * 1.7); });
      for (const side in ropes) {
        ropeAmp[side] *= Math.exp(-5 * dt);
        const axis = side[0], sign = side[1] === '+' ? 1 : -1;
        const off = ropeAmp[side] * Math.sin(time * 38);
        for (const r of ropes[side]) r.position[axis] = r.userData.base[axis] + sign * off;
      }
    },
    ropeBounce(axis, sign) { ropeAmp[`${axis}${sign > 0 ? '+' : '-'}`] = 0.12; },
  };
}
