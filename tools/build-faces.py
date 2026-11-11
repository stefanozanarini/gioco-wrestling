#!/usr/bin/env python3
"""Ritaglia i volti dalle foto in public/foto/ e prepara le texture per i modelli 3D.

Per ogni foto serve la posizione degli occhi (centro tra i due occhi, in pixel) e la distanza tra le pupille:
il ritaglio è normalizzato su queste misure, così gli occhi della foto finiscono sugli occhi del modello.
Uscita: public/models/volti/<nome>.png (bordo sfumato nel canale alfa) e volti.json (tinta della pelle).
Uso: python3 tools/build-faces.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'foto'
OUT = ROOT / 'public' / 'models' / 'volti'
SKIN_TEX = ROOT / 'public' / 'models' / 'quaternius' / 'T_Superhero_Male_Ligh.jpg'

# nome: (x occhi, y occhi, distanza tra le pupille) in pixel della foto originale
EYES = {
    'trucker': (141, 48, 26), 'guido': (135.5, 58, 19), 'nico': (138, 58, 22), 'jason': (130, 56, 25),
    'dozer': (131.5, 67, 13), 'zodiac': (147, 66, 20), 'lello': (138, 52, 22),
    'malpensa': (91, 80, 30), 'rangoni': (129, 32, 13),
    'mosquito': (147.5, 196, 75),   # maschera: centri dei fori degli occhi
}
# volti coperti da una maschera: la tinta della pelle si prende da questo riquadro (petto) invece che da fronte e guance
SKIN_BOX = {'mosquito': (95, 440, 185, 500)}
# volto ingrandito sul modello (il disegno della maschera copre tutta la testa)
FACE_SCALE = {'mosquito': 1.4}
# sopracciglia folte o espressione accigliata: sul modello diventano strisce scure, si schiariscono verso la pelle (0..1)
SOFT_BROWS = {'jason': 0.7, 'zodiac': 0.65}
# ritaglio in multipli della distanza tra le pupille (stessi valori nello shader: FACE_W, FACE_H, FACE_EYE)
FACE_W, FACE_H, FACE_EYE = 2.6, 2.8, 1.2
W, H = 128, 138


def mean_rgb(im, box):
    px = [p for p in im.crop(box).getdata() if sum(p) > 150]   # niente barba né ombre scure
    if not px:
        return None
    return [sum(c[i] for c in px) / len(px) for i in range(3)]


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def soften_brows(face, skin, k):
    """Schiarisce i pixel più scuri della pelle nella fascia delle sopracciglia (sopra gli occhi), con bordi sfumati."""
    px = face.load()
    ipd = W / FACE_W                     # distanza tra le pupille nel ritaglio, in pixel
    ey = H * FACE_EYE / FACE_H           # altezza degli occhi nel ritaglio
    skin_l = sum(skin) / 3
    for y in range(max(0, int(ey - 0.7 * ipd)), int(ey - 0.08 * ipd)):
        wy = 1 - smooth(0.12, 0.32, abs(y - (ey - 0.38 * ipd)) / ipd)
        for x in range(W):
            wx = 1 - smooth(0.7, 0.95, abs(x - W / 2) / ipd)
            r, g, b = px[x, y]
            dark = min(1.0, max(0.0, (skin_l - (r + g + b) / 3) / (skin_l * 0.45)))
            t = k * wy * wx * dark
            if t > 0:
                px[x, y] = tuple(round(c + (s - c) * t) for c, s in zip((r, g, b), skin))


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    tex = Image.open(SKIN_TEX).convert('RGB').resize((256, 256))
    tex_mean = mean_rgb(tex, (0, 0, 256, 256))
    # maschera ellittica con bordo sfumato: solo il viso, niente capelli ai lati
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse((W * 0.12, H * 0.1, W * 0.88, H * 0.98), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(7))
    info = {}
    for name, (ex, ey, d) in EYES.items():
        src = next(SRC.glob(name + '.*'), None)
        if not src:
            continue
        im = Image.open(src).convert('RGB')
        box = (ex - FACE_W / 2 * d, ey - FACE_EYE * d, ex + FACE_W / 2 * d, ey + (FACE_H - FACE_EYE) * d)
        face = im.crop(tuple(round(v) for v in box)).resize((W, H), Image.LANCZOS)
        # colore della pelle: fronte e guance
        samples = [mean_rgb(im, (round(ex - 0.4 * d), round(ey - 0.75 * d), round(ex + 0.4 * d), round(ey - 0.45 * d))),
                   mean_rgb(im, (round(ex - 0.75 * d), round(ey + 0.35 * d), round(ex - 0.4 * d), round(ey + 0.7 * d))),
                   mean_rgb(im, (round(ex + 0.4 * d), round(ey + 0.35 * d), round(ex + 0.75 * d), round(ey + 0.7 * d)))]
        if name in SKIN_BOX:
            samples = [mean_rgb(im, SKIN_BOX[name])]
        samples = [s for s in samples if s]
        skin = [sum(s[i] for s in samples) / len(samples) for i in range(3)]
        # foto scure (luci di scena): si schiarisce il viso fino a una luminosità standard
        gain = min(1.6, max(1.0, 185 / (sum(skin) / 3)))
        if gain > 1.01:
            face = face.point(lambda v: min(255, round(v * gain)))
            skin = [min(255, c * gain) for c in skin]
        if name in SKIN_BOX:
            # maschera: lo sfondo arancione che spunta ai bordi diventa nero come la maschera
            px = face.load()
            for y in range(H):
                for x in range(W):
                    r, g, b = px[x, y]
                    if r - b > 70:
                        px[x, y] = (12, 12, 14)
        if name in SOFT_BROWS:
            soften_brows(face, skin, SOFT_BROWS[name])
        face.putalpha(mask)
        face.save(OUT / f'{name}.png')
        # la tinta moltiplica la texture della pelle del modello: si normalizza sul canale più chiaro
        tint = [skin[i] / tex_mean[i] for i in range(3)]
        top = max(tint)
        info[name] = {'skinTint': '#%02x%02x%02x' % tuple(round(t / top * 255) for t in tint)}
        if name in FACE_SCALE:
            info[name]['scale'] = FACE_SCALE[name]
        print(name, src.name, 'pelle', [round(v) for v in skin], info[name]['skinTint'])
    (OUT / 'volti.json').write_text(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
