"""Prepara per il web i Universal Base Characters (CC0, Quaternius):
copia personaggio e capelli glTF, ridimensiona le texture e corregge i percorsi.
Uso: python3 -I tools/build-assets.py <cartella 'Universal Base Characters[Standard]'> <uscita>"""
import json, os, shutil, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
tex_dir = os.path.join(src, 'Base Characters', 'Textures')
normals_dir = os.path.join(tex_dir, 'Normals Unity - Godot')  # convenzione OpenGL, quella del glTF
hair_tex = os.path.join(src, 'Hairstyles', 'Textures')
SIZE = 1024

def find_texture(uri):
    base = uri.replace('_png', '')
    name, _ = os.path.splitext(base)
    for d in (normals_dir, tex_dir, hair_tex) if 'Normal' in name else (tex_dir, hair_tex):
        for f in os.listdir(d):
            if os.path.splitext(f)[0] == name:
                return os.path.join(d, f)
    raise FileNotFoundError(uri)

def convert_image(path):
    name = os.path.splitext(os.path.basename(path))[0]
    im = Image.open(path)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    if 'Normal' in name:
        dst = name + '.png'
        im.convert('RGB').save(os.path.join(out, dst), optimize=True)
    else:
        dst = name + '.jpg'
        im.convert('RGB').save(os.path.join(out, dst), quality=85, optimize=True)
    return dst

def copy_gltf(gltf_path, new_name):
    g = json.load(open(gltf_path))
    folder = os.path.dirname(gltf_path)
    for b in g.get('buffers', []):
        shutil.copy(os.path.join(folder, b['uri']), os.path.join(out, new_name + '.bin'))
        b['uri'] = new_name + '.bin'
    for img in g.get('images', []):
        dst = convert_image(find_texture(img['uri']))
        img['uri'] = dst
        img['mimeType'] = 'image/png' if dst.endswith('.png') else 'image/jpeg'
    json.dump(g, open(os.path.join(out, new_name + '.gltf'), 'w'))
    print(new_name, [i['uri'] for i in g.get('images', [])])

chars = os.path.join(src, 'Base Characters', 'Godot - UE')
copy_gltf(os.path.join(chars, 'Superhero_Male_FullBody.gltf'), 'ragazzo')
# carnagione scura, alternativa per alcuni giocatori
convert_image(os.path.join(tex_dir, 'T_Superhero_Male_Ligh.png'))
hair = os.path.join(src, 'Hairstyles', 'Origin at 0', 'glTF (Godot)')
for h in ('Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Eyebrows_Regular'):
    copy_gltf(os.path.join(hair, h + '.gltf'), h)
for f in os.listdir(src):
    if f.lower().startswith('license'):
        shutil.copy(os.path.join(src, f), os.path.join(out, 'LICENSE-personaggi.txt'))
