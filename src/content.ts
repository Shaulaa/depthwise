import type { GameId } from './core/Store';

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

/** Shown in the credits line of the stamp book. */
export const AUTHOR = 'Rafif Shula Syandana';
