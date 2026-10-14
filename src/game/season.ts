import Phaser from 'phaser';
import type { Temperature } from './daycycle';
import {
  BOSS_EVERY,
  BOSS_LEVEL_LENGTH,
  LEVEL_MAX_LENGTH,
  LEVEL_MIN_LENGTH,
  LEVELS_PER_SEASON,
  TUTORIAL_LENGTH,
} from './constants';
import { ALL_ENEMY_KINDS, ENEMY_CLASSES, ENEMY_DEFS } from './enemies';

export type EnemyKind =
  | 'crab' | 'gnat' | 'spitter' | 'bat' | 'turret' | 'charger' | 'bomber'
  | 'shooter' | 'blob' | 'turtle' | 'healer' | 'sniper' | 'mole'
  /** Учебная мишень — только на уровне 0. */
  | 'dummy';
export type AmbientKind = 'motes' | 'leaves' | 'snow' | 'dust' | 'embers';
export type TreeShape = 'palm' | 'bush' | 'pine' | 'cactus' | 'spire';
export type BossPattern = 'burst' | 'fan' | 'spiral' | 'charge' | 'summon' | 'sweep' | 'meteor';

/** Палитра и содержимое одного биома. Цвета — CSS-строки для canvas. */
export interface Biome {
  id: string;
  name: string;
  ground: string;
  groundLight: string;
  groundDark: string;
  cliff: string;
  cliffLight: string;
  cliffDark: string;
  rock: string;
  rockLight: string;
  rockDark: string;
  foliage: string;
  foliageLight: string;
  foliageDark: string;
  trunk: string;
  treeShape: TreeShape;
  pool: string;
  poolLight: string;
  poolHurts: boolean;
  accent: string;
  fog: string;
  ambient: AmbientKind;
  enemies: EnemyKind[];
  boss: { name: string; color: string; colorDark: string; patterns: BossPattern[]; temp: Temperature };
}

export interface Season {
  name: string;
  biomes: Biome[];
}

/** Сезон 1 — стилистика острова из PEAK: берег → тропики → альпы → меса → кальдера. */
const ISLAND: Season = {
  name: 'Остров',
  biomes: [
    {
      id: 'shore', name: 'Берег',
      ground: '#efd7a2', groundLight: '#f8e8c2', groundDark: '#d9b97f',
      cliff: '#8fa3a8', cliffLight: '#b9cacd', cliffDark: '#5f7378',
      rock: '#a7b4b4', rockLight: '#d2dbd8', rockDark: '#6f7f80',
      foliage: '#5dbb63', foliageLight: '#8fdc7a', foliageDark: '#2f7d4a', trunk: '#a77b4f',
      treeShape: 'palm', pool: '#4cc3c9', poolLight: '#9be7e4', poolHurts: false,
      accent: '#ff8f8f', fog: '#bfeff2', ambient: 'motes',
      enemies: ['crab', 'spitter'],
      boss: { name: 'Краб-отшельник', color: '#ff6f59', colorDark: '#b23a3a', patterns: ['burst', 'charge', 'summon'], temp: 'warm' },
    },
    {
      id: 'tropics', name: 'Тропики',
      ground: '#79b85a', groundLight: '#9fd46f', groundDark: '#4f8f46',
      cliff: '#4f7a54', cliffLight: '#76a46f', cliffDark: '#2f5340',
      rock: '#8a9a7a', rockLight: '#b6c49a', rockDark: '#566650',
      foliage: '#2f9a55', foliageLight: '#5fcf6a', foliageDark: '#1c6340', trunk: '#7a5a3a',
      treeShape: 'bush', pool: '#3aa6a0', poolLight: '#7fdcc4', poolHurts: false,
      accent: '#ff5fa2', fog: '#c8f0b0', ambient: 'leaves',
      enemies: ['bat', 'turtle'],
      boss: { name: 'Хищная росянка', color: '#e0457b', colorDark: '#8a1f4f', patterns: ['spiral', 'fan', 'sweep', 'summon'], temp: 'warm' },
    },
    {
      id: 'alpine', name: 'Альпы',
      ground: '#e8f1f8', groundLight: '#ffffff', groundDark: '#c3d4e6',
      cliff: '#8796b0', cliffLight: '#b8c6dc', cliffDark: '#56627c',
      rock: '#9aa8bd', rockLight: '#d6e0ee', rockDark: '#626f88',
      foliage: '#2f6a5a', foliageLight: '#4f9a7f', foliageDark: '#1d473f', trunk: '#6b4f3a',
      treeShape: 'pine', pool: '#a8d8f0', poolLight: '#e0f6ff', poolHurts: false,
      accent: '#7fb8ff', fog: '#f0f6ff', ambient: 'snow',
      enemies: ['charger', 'mole'],
      boss: { name: 'Снежный як', color: '#f2f2f2', colorDark: '#7d8aa6', patterns: ['charge', 'sweep', 'meteor', 'burst'], temp: 'cold' },
    },
    {
      id: 'mesa', name: 'Меса',
      ground: '#e8a56a', groundLight: '#f5c48f', groundDark: '#c97f4c',
      cliff: '#b8583a', cliffLight: '#d9805a', cliffDark: '#7d3426',
      rock: '#c76f4a', rockLight: '#e89a6c', rockDark: '#8a4330',
      foliage: '#5fa36a', foliageLight: '#86c78a', foliageDark: '#3c7149', trunk: '#5fa36a',
      treeShape: 'cactus', pool: '#d9b06a', poolLight: '#f0d59a', poolHurts: false,
      accent: '#ffd25f', fog: '#ffe2bf', ambient: 'dust',
      enemies: ['shooter', 'bomber'],
      boss: { name: 'Скорпион-матриарх', color: '#3a3248', colorDark: '#1c1726', patterns: ['fan', 'sweep', 'summon', 'charge'], temp: 'warm' },
    },
    {
      id: 'caldera', name: 'Кальдера',
      ground: '#4a3d44', groundLight: '#5f4f55', groundDark: '#2f262c',
      cliff: '#2c2228', cliffLight: '#4a3a40', cliffDark: '#17111a',
      rock: '#3d3238', rockLight: '#5d4b52', rockDark: '#211a1f',
      foliage: '#ff7a2f', foliageLight: '#ffc04f', foliageDark: '#b23a1f', trunk: '#2b2026',
      treeShape: 'spire', pool: '#ff5a1f', poolLight: '#ffcf4f', poolHurts: true,
      accent: '#ffb03f', fog: '#5a3a3a', ambient: 'embers',
      enemies: ['blob', 'turret'],
      boss: { name: 'Лавовый монстр', color: '#ff6a2b', colorDark: '#7a1f1f', patterns: ['spiral', 'meteor', 'burst', 'sweep', 'fan', 'summon'], temp: 'warm' },
    },
  ],
};


/** Сезон 2 — тот же маршрут, но в сумеречной стилистике. */
const DUSK_PALETTES: Partial<Biome>[] = [
  {
    name: 'Лунный берег', ground: '#8d8fb8', groundLight: '#a9abd0', groundDark: '#6c6d99',
    cliff: '#3f4570', cliffLight: '#5b6496', cliffDark: '#262a4a',
    rock: '#6d7299', rockLight: '#9aa0c8', rockDark: '#454a70',
    foliage: '#3f8f8a', foliageLight: '#62bdb0', foliageDark: '#24585f',
    pool: '#2f5fa8', poolLight: '#6fa0e8', fog: '#4b5490', accent: '#ffe08a',
  },
  {
    name: 'Ночные джунгли', ground: '#2f5a4a', groundLight: '#3f7560', groundDark: '#1f3f35',
    cliff: '#1d3a34', cliffLight: '#2f5a4f', cliffDark: '#0f221f',
    foliage: '#1f6f5a', foliageLight: '#3fbfa0', foliageDark: '#0f3f35',
    pool: '#1f8a8a', poolLight: '#6ff0d0', fog: '#1f4a4a', accent: '#c3ff5f', ambient: 'motes',
  },
  {
    name: 'Ледник', ground: '#b9c9e8', groundLight: '#dbe6ff', groundDark: '#8fa3cf',
    cliff: '#4f5f95', cliffLight: '#7486c0', cliffDark: '#2f3a66',
    foliage: '#2a4a6a', foliageLight: '#4a7aa0', foliageDark: '#1a2f4a',
    pool: '#7fc8ff', poolLight: '#d0f0ff', fog: '#9fb0e0', accent: '#b08aff',
  },
  {
    name: 'Пустошь', ground: '#9a6a7a', groundLight: '#b98a95', groundDark: '#744d5c',
    cliff: '#5a2f4a', cliffLight: '#7f4a66', cliffDark: '#381c30',
    rock: '#8a5a6f', rockLight: '#b07f92', rockDark: '#5a3548',
    pool: '#8f6f9a', poolLight: '#c0a0cf', fog: '#7a4a6a', accent: '#ffb05f',
  },
  {
    name: 'Пепелище', ground: '#3a3348', groundLight: '#4f4660', groundDark: '#241f30',
    cliff: '#1c1828', cliffLight: '#342d48', cliffDark: '#0d0b14',
    pool: '#b03fff', poolLight: '#f0a0ff', fog: '#3a2050', accent: '#ff5fd0',
    foliage: '#b03fff', foliageLight: '#f0a0ff', foliageDark: '#5a1f8a',
  },
];

const DUSK: Season = {
  name: 'Сумерки',
  biomes: ISLAND.biomes.map((b, i) => ({ ...b, ...DUSK_PALETTES[i], id: `dusk-${b.id}` })),
};

/** Сезоны идут по кругу: каждый новый сезон — заново и в новой стилистике. */
export const SEASONS: Season[] = [ISLAND, DUSK];

export function getSeason(season: number): Season {
  return SEASONS[season % SEASONS.length];
}

/** Стиль раскладки уровня — меняется от уровня к уровню. */
export type LayoutStyle = 'open' | 'groves' | 'walls' | 'wetlands' | 'canyon';
const LAYOUT_STYLES: LayoutStyle[] = ['open', 'groves', 'walls', 'wetlands', 'canyon'];

export interface LevelPlan {
  season: number;
  level: number;
  biomeIndex: number;
  biome: Biome;
  isBoss: boolean;
  length: number;
  enemyCount: number;
  enemyKinds: EnemyKind[];
  layoutStyle: LayoutStyle;
  /** Уровень 0 — обучение. */
  isTutorial: boolean;
  /** true — враги стоят группами, false — россыпью. */
  packs: boolean;
  /** Множитель силы врагов: растёт по ходу сезона и с каждым сезоном. */
  difficulty: number;
  obstacleDensity: number;
  rng: Phaser.Math.RandomDataGenerator;
}

export function isBossLevel(level: number): boolean {
  return level > 0 && level % BOSS_EVERY === 0;
}

/** Номер биома для уровня (уровень 0 — обучение — проходит в первом биоме). */
function biomeIndexFor(season: number, level: number): number {
  const count = getSeason(season).biomes.length;
  return Phaser.Math.Clamp(Math.floor((level - 1) / BOSS_EVERY), 0, count - 1);
}

export function planLevel(season: number, level: number, seed: string): LevelPlan {
  const rng = new Phaser.Math.RandomDataGenerator([`${seed}:${season}:${level}`]);
  const biomes = getSeason(season).biomes;
  const biomeIndex = biomeIndexFor(season, level);
  const biome = biomes[biomeIndex];
  const progress = Math.max(0, (level - 1) / (LEVELS_PER_SEASON - 1));
  const isBoss = isBossLevel(level);
  const isTutorial = level === 0;

  const baseLength = Phaser.Math.Linear(LEVEL_MIN_LENGTH, LEVEL_MAX_LENGTH * 0.85, progress);
  const length = isTutorial ? TUTORIAL_LENGTH : isBoss
    ? BOSS_LEVEL_LENGTH
    : Phaser.Math.Clamp(Math.round(baseLength + rng.between(-450, 600)), LEVEL_MIN_LENGTH, LEVEL_MAX_LENGTH);

  const perThousand = 3.4 + progress * 2.6;
  const enemyCount = isTutorial ? 0 : isBoss ? 4 : Math.round((length / 1000) * perThousand) + rng.between(0, 2);

  return {
    season,
    level,
    biomeIndex,
    biome,
    isBoss,
    length,
    enemyCount,
    enemyKinds: enemyMixFor(season, level, seed),
    layoutStyle: isBoss || isTutorial ? 'open' : layoutStyleFor(season, level, seed),
    isTutorial,
    packs: rng.frac() < 0.5,
    difficulty: 1 + progress * 2 + season * 0.9,
    obstacleDensity: 7 + progress * 5,
    rng,
  };
}

function biomeFor(season: number, level: number): Biome {
  return getSeason(season).biomes[biomeIndexFor(season, level)];
}

function rngFor(seed: string, season: number, level: number, salt: string): Phaser.Math.RandomDataGenerator {
  return new Phaser.Math.RandomDataGenerator([`${seed}:${season}:${level}:${salt}`]);
}

/**
 * Микс врагов уровня: 1–2 биомных врага (они меняются каждые 7 уровней вместе с биомом)
 * + 0–2 общих, уже открытых к этому уровню. Предпочитаем классы, которых в миксе ещё нет.
 */
function rollMix(rng: Phaser.Math.RandomDataGenerator, biome: Biome, level: number): EnemyKind[] {
  const local = rng.frac() < 0.6 ? [...biome.enemies] : [rng.pick(biome.enemies)];
  const commons = ALL_ENEMY_KINDS.filter((k) => ENEMY_DEFS[k].common && ENEMY_DEFS[k].unlock <= level);
  const commonCount = Math.min(commons.length, rng.between(0, Math.min(2, 1 + Math.floor(level / 10))));
  const mix: EnemyKind[] = [...local];
  for (let i = 0; i < commonCount; i++) {
    const missing = ENEMY_CLASSES.filter((c) => !mix.some((k) => ENEMY_DEFS[k].cls === c));
    let candidates = commons.filter((k) => !mix.includes(k) && missing.includes(ENEMY_DEFS[k].cls));
    if (candidates.length === 0) candidates = commons.filter((k) => !mix.includes(k));
    if (candidates.length === 0) break;
    mix.push(rng.pick(candidates));
  }
  // Минимум два типа врагов на уровне — иначе скучно.
  if (mix.length < 2) mix.push(...biome.enemies.filter((k) => !mix.includes(k)).slice(0, 1));
  return mix;
}

function sameSet(a: EnemyKind[], b: EnemyKind[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

/** Микс гарантированно отличается от микса прошлого уровня. */
function enemyMixFor(season: number, level: number, seed: string): EnemyKind[] {
  let mix = rollMix(rngFor(seed, season, level, 'mix'), biomeFor(season, level), level);
  if (level <= 1) return mix;
  const prev = rollMix(rngFor(seed, season, level - 1, 'mix'), biomeFor(season, level - 1), level - 1);
  for (let attempt = 0; attempt < 6 && sameSet(mix, prev); attempt++) {
    mix = rollMix(rngFor(seed, season, level, `mix-${attempt}`), biomeFor(season, level), level);
  }
  return mix;
}

function rollStyle(seed: string, season: number, level: number): LayoutStyle {
  return rngFor(seed, season, level, 'style').pick(LAYOUT_STYLES);
}

/** Стиль раскладки не повторяет стиль прошлого уровня. */
function layoutStyleFor(season: number, level: number, seed: string): LayoutStyle {
  const style = rollStyle(seed, season, level);
  if (level <= 1 || style !== rollStyle(seed, season, level - 1)) return style;
  return LAYOUT_STYLES[(LAYOUT_STYLES.indexOf(style) + 1) % LAYOUT_STYLES.length];
}
