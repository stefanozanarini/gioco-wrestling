// Lottatori e staff BWT (dalle schede del sito). Altezza in metri, peso in kg.
// Il peso decide la corporatura (più robusto, pancia) e lo stile di gioco: i pesi massimi sono più lenti
// ma colpiscono più forte, i leggeri sono più rapidi.
//
// Abbigliamento (dipinto sul modello 3D):
//   trunks/trim   slip o pantaloncini (trunksLen 0 = slip, 1 = pantaloncini lunghi) oppure calzamaglia (tights)
//   tightsPattern 'arcobaleno' | 'fiamme'
//   top           { kind: 'canotta' | 'body' | 'completo', color, trim, color3, tieStripes }
//   boots, pads, tape (nastro/polsini, null = niente), beard + beardLen, cap, glasses, mask
//   hairStyle     'corti' | 'medi' | 'lunghi' | null (calvo); headband: fascia sulla fronte (colore)
//   hat           cappello da cowboy (colore)
//   mask          maschera (colore): con face il disegno della maschera viene dalla foto; antennae: antenne (colore)
//   lean          fisico asciutto e poco muscoloso (altrimenti la corporatura viene dal peso)
//   face          volto dalla foto in public/foto/ (vedi tools/build-faces.py)
export const ROSTER = [
  {
    name: 'TRUCKER', face: 'trucker', nickname: 'Il Camionista', from: 'Padova', height: 1.92, kg: 133,
    lightSkin: true, skinTint: '#ffffff',
    hairStyle: null, beard: '#3b2a1c', beardLen: 1,
    top: { kind: 'canotta', color: '#38443f', trim: '#2a3330' },
    trunks: '#141414', trim: '#141414', trunksLen: 1, boots: '#141414', pads: '#141414', tape: null,
  },
  {
    name: 'GUIDO', face: 'guido', nickname: 'The Italian Revolution', from: 'Ferrara', height: 1.86, kg: 83,
    lightSkin: true, skinTint: '#f2dcc6',
    hairStyle: 'medi', hair: '#1c130d', headband: '#d4af37',
    trunks: '#1f3c9c', trim: '#d4af37', boots: '#d4af37', pads: '#1f3c9c', tape: '#f4f4f4',
  },
  {
    name: 'NICO NARCISO', face: 'nico', nickname: 'La Bellezza Ribelle', from: 'Ancona', height: 1.90, kg: 85,
    lightSkin: true, skinTint: '#ffffff',
    hairStyle: 'corti', hair: '#5a3a22',
    tights: true, tightsPattern: 'arcobaleno',
    trunks: '#e8409a', trim: '#e8409a', boots: '#f2f2f2', pads: '#e8409a', tape: '#1e6fd9',
  },
  {
    name: 'JASON', face: 'jason', nickname: 'Cannonball', from: 'Ferrara', height: 1.83, kg: 142,
    lightSkin: true, skinTint: '#ffffff',
    hairStyle: 'lunghi', hair: '#1e1712', beard: '#1e1712', beardLen: 0.5,
    top: { kind: 'body', color: '#c8102e', trim: '#f4f4f4', color3: '#111111' },
    trunks: '#111111', trim: '#111111', boots: '#111111', pads: '#111111', tape: '#f2f2f2',
  },
  {
    name: 'VP DOZER', face: 'dozer', nickname: 'Il Napoleone del Ring', from: 'Lesina Beach "Califoggia"', height: 1.90, kg: 110,
    lightSkin: true, skinTint: '#f4e0cc',
    hairStyle: 'corti', hair: '#17110d', beard: '#17110d', beardLen: 0.3,
    trunks: '#d4af37', trim: '#f5f5f5', boots: '#111111', pads: '#d4af37', tape: '#f4f4f4',
  },
  {
    name: 'ZODIAC', face: 'zodiac', nickname: 'Il signore delle tenebre', from: 'Muro del Pianto', height: 1.76, kg: 83, lean: true,
    lightSkin: true, skinTint: '#ffffff',
    hairStyle: 'lunghi', hair: '#8b6b3e',
    tights: true, tightsPattern: 'fiamme',
    trunks: '#6a1fb0', trim: '#111111', boots: '#111111', pads: '#111111', tape: '#111111',
  },
  {
    name: 'LEONARDO BULGARI JR', face: 'lello', nickname: 'The coolest kid in town', from: 'Bologna', height: 1.83, kg: 73,
    lightSkin: true, skinTint: '#ffffff',
    hairStyle: null, hair: '#2a1a10', cap: '#151515',
    top: { kind: 'canotta', color: '#f2f2f2', trim: '#3a3a3a' },
    tights: true, trunks: '#1f5fd0', trim: '#1f5fd0', boots: '#f2f2f2', pads: '#1f5fd0', tape: null,
  },
  {
    name: 'EL MOSQUITO', face: 'mosquito', nickname: 'La Zanzara', height: 1.75, kg: 76, lean: true,
    lightSkin: true, skinTint: '#ffffff',
    mask: '#0d0d0f', antennae: '#f2e6b0',
    trunks: '#111111', trim: '#f2f2f2', boots: '#111111', pads: '#111111', tape: '#f2f2f2',
  },
];

export const REFEREE = {
  name: 'Arbitro', isRef: true, slim: true, height: 1.76, kg: 74,
  lightSkin: true, skinTint: '#ffffff', hair: '#777777', hairStyle: 'corti',
  trunks: '#151515', trim: '#151515', boots: '#151515', pads: '#151515', tape: null,
};

// staff: presentatore sul ring e dirigente a bordo ring
export const STAFF = {
  speaker: {
    name: 'LIAM RANGONI', face: 'rangoni', role: 'Presentatore', isStaff: true, slim: true, height: 1.80, kg: 75,
    lightSkin: true, skinTint: '#f2dcc6', hairStyle: 'corti', hair: '#0e0b09', beard: '#0e0b09', beardLen: 0, hat: '#3a2a1e',
    top: { kind: 'completo', color: '#16203a', trim: '#f2f2f2', color3: '#0d0d10' },
    tights: true, trunks: '#16203a', trim: '#16203a', boots: '#0b0b0b', pads: '#16203a', tape: null,
  },
  boss: {
    name: 'MAX MALPENSA', face: 'malpensa', role: 'Dirigente BWT', isStaff: true, slim: true, height: 1.75, kg: 80,
    lightSkin: true, skinTint: '#ffffff', hairStyle: 'corti', hair: '#1a1410', glasses: true,
    top: { kind: 'completo', color: '#3a3e4a', trim: '#f4f4f4', color3: '#7a1424', tieStripes: true },
    tights: true, trunks: '#24262e', trim: '#24262e', boots: '#0b0b0b', pads: '#24262e', tape: null,
  },
};
