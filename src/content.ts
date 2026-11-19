import type { GameId } from './core/Store';
import type { Look, Outfit } from './world/Character';

export type IslandId = 'hub' | GameId;

export interface IslandInfo {
  id: IslandId;
  /** Three-letter port code, airline style. */
  code: string;
  name: string;
  /** What kind of stop this is. */
  kind: string;
  blurb: string;
  /** Height above the sea in metres, for flavour. */
  altitude: number;
  game?: {
    title: string;
    goal: string;
  };
}

export const ISLANDS: readonly IslandInfo[] = [
  {
    id: 'hub',
    code: 'LBF',
    name: 'Labuan Fajar',
    kind: 'Pelabuhan',
    blurb:
      'Kota pelabuhan tempat semua perjalanan dimulai. Mercusuarnya jadi patokan pulang buat semua pelaut langit.',
    altitude: 1200,
  },
  {
    id: 'ubin',
    code: 'UBN',
    name: 'Pulau Ubin',
    kind: 'Teka-teki',
    blurb:
      'Reruntuhan pelataran batu. Mozaik lamanya teracak, dan cuma bisa disusun lagi dengan menggeser ubinnya satu per satu.',
    altitude: 1340,
    game: { title: 'Ubin Geser', goal: 'Susun ulang mozaik pelataran' },
  },
  {
    id: 'rimba',
    code: 'RMB',
    name: 'Rimba Kunang',
    kind: 'Cari benda',
    blurb:
      'Hutan lebat yang berpendar tiap malam. Enam kristal kunang jatuh dan terselip di antara pohon, batu, dan jamur raksasa.',
    altitude: 1280,
    game: { title: 'Kristal Kunang', goal: 'Temukan 6 kristal yang tersembunyi' },
  },
  {
    id: 'angin',
    code: 'TJA',
    name: 'Tanjung Angin',
    kind: 'Balapan',
    blurb:
      'Dataran tinggi tempat angin nggak pernah berhenti. Kincirnya muter terus, dan cincin-cincin angin menunggu buat dilewati.',
    altitude: 1460,
    game: { title: 'Balap Cincin', goal: 'Lewati minimal 9 dari 12 cincin' },
  },
  {
    id: 'lentera',
    code: 'BKL',
    name: 'Bukit Lentera',
    kind: 'Ingatan',
    blurb:
      'Bukit sunyi dengan pelataran lentera. Lenteranya menyala berurutan, dan nadanya harus diulang persis sama.',
    altitude: 1540,
    game: { title: 'Nyanyian Lentera', goal: 'Ulangi nada sampai 5 babak' },
  },
];

export const islandInfo = (id: IslandId): IslandInfo => {
  const info = ISLANDS.find((island) => island.id === id);
  if (!info) throw new Error(`Unknown island: ${id}`);
  return info;
};

// ---------------------------------------------------------------- islanders

/** What the islanders know about the player when they talk. */
export interface Progress {
  stamps: readonly GameId[];
  feathers: number;
  featherTotal: number;
  /** Best result for a game, already formatted, or null. */
  record(id: GameId): string | null;
}

export interface NpcInfo {
  id: string;
  island: IslandId;
  name: string;
  role: string;
  look: Look;
  outfit: Outfit;
  /** Where they hang about: from the island's game spot or its pier, `towards` the middle and `side` across. */
  home: { from: 'station' | 'pier'; towards: number; side: number };
  /** How far they stroll from home. */
  wander: number;
  /** What they say this time, one bubble per line. */
  lines(p: Progress): string[];
}

export const NPCS: readonly NpcInfo[] = [
  {
    id: 'bayu',
    island: 'hub',
    name: 'Pak Bayu',
    role: 'Syahbandar',
    look: { skin: '#e2b48c', hair: '#5a5550', pants: '#27325a', headwear: 'cap', hat: '#27325a' },
    outfit: { jacket: '#3f5a8a', scarf: '#f4ead2' },
    home: { from: 'pier', towards: 9, side: 2.5 },
    wander: 2.5,
    lines: (p) => [
      'Selamat datang di Labuan Fajar, pelaut langit!',
      p.stamps.length === 4
        ? 'Empat cap lengkap. Mercusuar kita menyala terang berkat kamu.'
        : `Capmu baru ${p.stamps.length} dari 4. Tiap pulau punya permainan di titik bercahaya keemasan, menang di sana buat dapat cap.`,
      'Kalau mau berangkat, kapalmu nunggu di ujung dermaga. Tekan M kalau butuh peta.',
    ],
  },
  {
    id: 'laras',
    island: 'hub',
    name: 'Laras',
    role: 'Kurir angin',
    look: { skin: '#f6d2b0', hair: '#8a4b2f', pants: '#5b4636', headwear: 'bun', hat: '#e0583d' },
    outfit: { jacket: '#f6e3b0', scarf: '#2f7f86' },
    home: { from: 'station', towards: -2, side: 4 },
    wander: 3,
    lines: (p) =>
      p.feathers >= p.featherTotal
        ? ['Semua bulu angin ketemu? Hebat banget!', 'Buka buku cap deh. Ada kostum Bulu Angin yang cuma buat kolektor sejati.']
        : [
            'Aku lagi ngumpulin bulu angin. Jatuhnya dari burung-burung besar yang lewat di atas pulau.',
            `Kamu udah nemu ${p.feathers} dari ${p.featherTotal}. Tiap pulau ada tiga, dan satu biasanya agak tinggi, jadi coba lompat.`,
          ],
  },
  {
    id: 'arya',
    island: 'ubin',
    name: 'Arya',
    role: 'Arkeolog',
    look: { skin: '#d9a77c', hair: '#2b2220', pants: '#6b5a3e', headwear: 'straw', hat: '#e3c27a' },
    outfit: { jacket: '#c9b48a', scarf: '#7a5a44' },
    home: { from: 'station', towards: -1, side: 4.5 },
    wander: 2.5,
    lines: (p) => [
      'Pelataran ini dulunya mozaik raksasa. Sekarang ubinnya teracak semua.',
      p.stamps.includes('ubin')
        ? `Mozaiknya utuh lagi! Rekormu ${p.record('ubin') ?? '-'}. Catatan penelitianku jadi lengkap.`
        : 'Geser ubinnya satu per satu sampai gambarnya pas. Ada gambar contohnya di pojok layar.',
    ],
  },
  {
    id: 'rimbi',
    island: 'rimba',
    name: 'Mbok Rimbi',
    role: 'Penjaga hutan',
    look: { skin: '#c99872', hair: '#d8d2c8', pants: '#3a4a3c', headwear: 'hood', hat: '#3f7a56' },
    outfit: { jacket: '#5f8a5a', scarf: '#c9a84a' },
    home: { from: 'station', towards: 3, side: -3 },
    wander: 2,
    lines: (p) => [
      'Ssst... hutan ini paling cantik pas malam. Coba tekan T sampai langitnya gelap.',
      p.stamps.includes('rimba')
        ? 'Kristal kunangnya udah balik semua. Terima kasih, Nak.'
        : 'Enam kristal kunang jatuh di sini. Ada yang dekat kolam, ada juga yang cuma kelihatan dari bawah pulau.',
    ],
  },
  {
    id: 'dimas',
    island: 'angin',
    name: 'Dimas',
    role: 'Pilot balap',
    look: { skin: '#e8b98f', hair: '#c9772f', pants: '#2c3046', headwear: 'goggles' },
    outfit: { jacket: '#e0583d', scarf: '#f6d365' },
    home: { from: 'station', towards: 3, side: 3 },
    wander: 2.5,
    lines: (p) => [
      'Angin di sini nggak pernah berhenti. Pas banget buat balapan!',
      p.record('angin')
        ? `Rekormu ${p.record('angin')}. Aku pernah dapat dua belas, lho. Berani coba lagi?`
        : 'Lewati minimal sembilan dari dua belas cincin. Beloknya halus aja, jangan panik.',
    ],
  },
  {
    id: 'sekar',
    island: 'lentera',
    name: 'Sekar',
    role: 'Penjaga kuil',
    look: { skin: '#f3cfae', hair: '#1e1a24', pants: '#4a3a5c', headwear: 'bun', hat: '#ffc857' },
    outfit: { jacket: '#f7c6d6', scarf: '#b8372b' },
    home: { from: 'station', towards: -2.5, side: 3.5 },
    wander: 1.5,
    lines: (p) => [
      'Lentera-lentera ini bernyanyi kalau dinyalakan berurutan.',
      p.stamps.includes('lentera')
        ? 'Lagu lentera udah kamu hafal. Kuil ini rasanya jadi lebih hangat.'
        : 'Dengarkan baik-baik. Tiap warna punya nadanya sendiri, dan urutannya makin panjang tiap babak.',
    ],
  },
];

// ---------------------------------------------------------------- costumes

export interface OutfitInfo extends Outfit {
  id: string;
  name: string;
  /** What it takes to wear it. */
  unlock: { stamps: number } | { feathers: 'all' };
}

export const OUTFITS: readonly OutfitInfo[] = [
  { id: 'pelaut', name: 'Pelaut langit', jacket: '#f4ead2', scarf: '#e0583d', unlock: { stamps: 0 } },
  { id: 'senja', name: 'Senja', jacket: '#f3d2b8', scarf: '#ff9f43', unlock: { stamps: 1 } },
  { id: 'laut', name: 'Laut awan', jacket: '#dfe9f2', scarf: '#2f7f86', unlock: { stamps: 2 } },
  { id: 'hutan', name: 'Rimba', jacket: '#e3ead2', scarf: '#3f8a5a', unlock: { stamps: 3 } },
  { id: 'malam', name: 'Malam lentera', jacket: '#2c3557', scarf: '#ffd76a', unlock: { stamps: 4 } },
  { id: 'angin', name: 'Bulu angin', jacket: '#fbf7ee', scarf: '#8fd8ff', unlock: { feathers: 'all' } },
];

export function outfitUnlocked(outfit: OutfitInfo, stamps: number, feathers: number, featherTotal: number): boolean {
  return 'stamps' in outfit.unlock ? stamps >= outfit.unlock.stamps : feathers >= featherTotal;
}

export function unlockText(outfit: OutfitInfo): string {
  if (!('stamps' in outfit.unlock)) return 'Kumpulkan semua bulu angin';
  return `Kumpulkan ${outfit.unlock.stamps} cap`;
}

/** Shown in the credits line of the stamp book. */
export const AUTHOR = 'Rafif Shula Syandana';
