import Phaser from 'phaser';
import { MAX_BURST, PLAYER_BASE_HP, PLAYER_BASE_STAMINA, SAVE_KEY } from './constants';

export type UpgradeId = 'burst' | 'spread' | 'ring' | 'speed' | 'health' | 'stamina' | 'damage' | 'firerate';
export type AbilityId =
  | 'frostRoll'
  | 'shockRoll'
  | 'echoRoll'
  | 'lightRoll'
  | 'pierce'
  | 'ricochet'
  | 'poison'
  | 'vampire'
  | 'shelter';

/** Всё, что переживает переход между уровнями (и сохраняется). */
export interface RunState {
  season: number;
  level: number;
  seed: string;
  hp: number;
  maxHp: number;
  maxStamina: number;
  speedMul: number;
  damageMul: number;
  fireRateMul: number;
  burst: number;
  spread: boolean;
  ring: boolean;
  upgrades: UpgradeId[];
  abilities: AbilityId[];
  xp: number;
  xpNeeded: number;
  kills: number;
}

export function newRun(season: number): RunState {
  return {
    season,
    level: 1,
    seed: Math.random().toString(36).slice(2),
    hp: PLAYER_BASE_HP,
    maxHp: PLAYER_BASE_HP,
    maxStamina: PLAYER_BASE_STAMINA,
    speedMul: 1,
    damageMul: 1,
    fireRateMul: 1,
    burst: 1,
    spread: false,
    ring: false,
    upgrades: [],
    abilities: [],
    xp: 0,
    xpNeeded: 0,
    kills: 0,
  };
}

export interface Choice<T extends string> {
  id: T;
  icon: string;
  title: string;
  desc: string;
  color: number;
  canTake: (run: RunState) => boolean;
  apply: (run: RunState) => void;
}

// --- Усиления оружия и героя (за опыт) ---------------------------------------------

export const UPGRADES: Choice<UpgradeId>[] = [
  {
    id: 'burst', icon: '⇈', title: 'Очередь', color: 0xff8a4f,
    desc: '+1 стрела подряд вперёд (до 3)',
    canTake: (r) => r.burst < MAX_BURST,
    apply: (r) => { r.burst += 1; },
  },
  {
    id: 'spread', icon: '⋎', title: 'Веер \\|/', color: 0xffc94f,
    desc: 'Каждый выстрел — три стрелы веером',
    canTake: (r) => !r.spread,
    apply: (r) => { r.spread = true; },
  },
  {
    id: 'ring', icon: '✺', title: 'Кольцо', color: 0xff5f8a,
    desc: 'Каждый третий залп — стрелы по кругу',
    canTake: (r) => !r.ring,
    apply: (r) => { r.ring = true; },
  },
  {
    id: 'speed', icon: '»', title: 'Быстрые ноги', color: 0x5fd0ff,
    desc: 'Скорость бега +12%',
    canTake: (r) => r.speedMul < 1.6,
    apply: (r) => { r.speedMul += 0.12; },
  },
  {
    id: 'health', icon: '♥', title: 'Крепкое сердце', color: 0xff4f5f,
    desc: 'Здоровье +25 и лечение',
    canTake: () => true,
    apply: (r) => { r.maxHp += 25; r.hp = Math.min(r.maxHp, r.hp + 40); },
  },
  {
    id: 'stamina', icon: '⚡', title: 'Выносливость', color: 0xc8f04f,
    desc: 'Выносливость +25: больше перекатов',
    canTake: (r) => r.maxStamina < 250,
    apply: (r) => { r.maxStamina += 25; },
  },
  {
    id: 'damage', icon: '✦', title: 'Острые наконечники', color: 0xd0a0ff,
    desc: 'Урон стрел +20%',
    canTake: () => true,
    apply: (r) => { r.damageMul += 0.2; },
  },
  {
    id: 'firerate', icon: '≫', title: 'Тугая тетива', color: 0x7fe0b0,
    desc: 'Стрельба быстрее на 15%',
    canTake: (r) => r.fireRateMul < 2.2,
    apply: (r) => { r.fireRateMul += 0.15; },
  },
];

// --- Абилки (гарантированно за босса) ----------------------------------------------

function ability(id: AbilityId, icon: string, title: string, desc: string, color: number): Choice<AbilityId> {
  return {
    id, icon, title, desc, color,
    canTake: (r) => !r.abilities.includes(id),
    apply: (r) => { r.abilities.push(id); },
  };
}

export const ABILITIES: Choice<AbilityId>[] = [
  ability('frostRoll', '❄', 'Ледяной перекат', 'Перекат замедляет врагов вокруг', 0x9fe0ff),
  ability('shockRoll', '➹', 'Таран', 'Перекат сквозь врагов наносит урон', 0xffb04f),
  ability('echoRoll', '✺', 'Эхо-залп', 'После переката — кольцо стрел', 0xff7fbf),
  ability('lightRoll', '☁', 'Лёгкий шаг', 'Перекат тратит меньше выносливости', 0xc8f04f),
  ability('pierce', '➶', 'Пробивание', 'Стрелы пробивают врага насквозь', 0xd8e2ea),
  ability('ricochet', '↯', 'Рикошет', 'Стрела отскакивает к другому врагу', 0x7fb8ff),
  ability('poison', '☠', 'Яд', 'Стрелы отравляют врагов', 0x8fe05f),
  ability('vampire', '♥', 'Вампиризм', 'Каждое убийство лечит', 0xff4f6f),
  ability('shelter', '◒', 'Укрытие', 'В приседе урон вдвое меньше', 0xb0a08a),
];

export function rollChoices<T extends string>(pool: Choice<T>[], run: RunState, count = 3): Choice<T>[] {
  const available = pool.filter((c) => c.canTake(run));
  return Phaser.Utils.Array.Shuffle([...available]).slice(0, count);
}

// --- Сохранение ------------------------------------------------------------------

export function saveRun(run: RunState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(run));
  } catch {
    // Хранилище может быть недоступно (приватный режим) — игра работает и без него.
  }
}

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    return typeof run.level === 'number' && typeof run.hp === 'number' ? run : null;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
