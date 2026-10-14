import Phaser from 'phaser';
import {
  BURST_UNLOCK_LEVELS,
  ENEMY_HP_PER_LEVEL,
  ENEMY_HP_PER_SEASON,
  ENEMY_HP_TRACKING,
  MAX_BURST,
  MAX_ORBIT,
  PLAYER_BASE_HP,
  PLAYER_BASE_STAMINA,
  RING_POWER,
  RING_UNLOCK_LEVEL,
  SAVE_KEY,
  SPREAD_POWER,
  SPREAD_UNLOCK_LEVEL,
  TUTORIAL_KEY,
} from './constants';

export type UpgradeId =
  | 'burst' | 'spread' | 'ring' | 'speed' | 'health' | 'stamina' | 'damage' | 'firerate'
  | 'orbit' | 'shield' | 'thorns' | 'crit' | 'regen' | 'magnet';

export type AbilityId =
  | 'frostRoll'
  | 'shockRoll'
  | 'echoRoll'
  | 'lightRoll'
  | 'pierce'
  | 'ricochet'
  | 'poison'
  | 'vampire'
  | 'shelter'
  | 'lightning'
  | 'explosive'
  | 'frostArrows'
  | 'secondWind'
  | 'adrenaline';

/** Статистика забега — показывается на финальном экране. */
export interface RunStats {
  time: number;
  /** Сколько пикселей пройдено вверх за завершённые уровни — от этого зависит время суток. */
  climb: number;
  arrows: number;
  hits: number;
  crits: number;
  damageDealt: number;
  damageTaken: number;
  rolls: number;
  dodges: number;
  orbs: number;
  bosses: number;
  killsByKind: Record<string, number>;
  /** За сколько секунд побеждён каждый босс. */
  bossTimes: number[];
}

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
  /** Стрелы, кружащие вокруг героя ("активная броня"). */
  orbit: number;
  /** Уровень щита: 0 — нет; чем выше, тем быстрее перезарядка. */
  shield: number;
  thorns: number;
  critChance: number;
  regen: number;
  magnetMul: number;
  upgrades: UpgradeId[];
  abilities: AbilityId[];
  xp: number;
  xpNeeded: number;
  kills: number;
  stats: RunStats;
}

export function newStats(): RunStats {
  return {
    time: 0, climb: 0, arrows: 0, hits: 0, crits: 0, damageDealt: 0, damageTaken: 0,
    rolls: 0, dodges: 0, orbs: 0, bosses: 0, killsByKind: {}, bossTimes: [],
  };
}

export function newRun(season: number): RunState {
  return {
    season,
    // Самый первый забег начинается с обучения (уровень 0).
    level: season === 0 && !isTutorialDone() ? 0 : 1,
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
    orbit: 0,
    shield: 0,
    thorns: 0,
    critChance: 0,
    regen: 0,
    magnetMul: 1,
    upgrades: [],
    abilities: [],
    xp: 0,
    xpNeeded: 0,
    kills: 0,
    stats: newStats(),
  };
}

/** Вклад атакующих абилок в силу героя (остальные абилки — защитные). */
const ABILITY_POWER: Partial<Record<AbilityId, number>> = {
  pierce: 1.15,
  ricochet: 1.15,
  poison: 1.1,
  echoRoll: 1.05,
  lightning: 1.1,
  explosive: 1.1,
};

/** Во сколько раз атака героя сильнее стартовой (грубая оценка урона в секунду). */
export function offensePower(run: RunState): number {
  const abilities = run.abilities.reduce((mul, id) => mul * (ABILITY_POWER[id] ?? 1), 1);
  return run.damageMul
    * run.fireRateMul
    * run.burst
    * (run.spread ? SPREAD_POWER : 1)
    * (run.ring ? RING_POWER : 1)
    * (1 + run.orbit * 0.12)
    * (1 + run.critChance)
    * abilities;
}

/**
 * Множитель HP врагов: растёт с каждым уровнем, но не быстрее,
 * чем часть реального роста атаки героя — прогресс чувствуется всегда.
 */
export function enemyHpMultiplier(run: RunState): number {
  const byLevel = 1 + (run.level - 1) * ENEMY_HP_PER_LEVEL;
  const byPower = 1 + (offensePower(run) - 1) * ENEMY_HP_TRACKING;
  return Math.min(byLevel, byPower) * (1 + run.season * ENEMY_HP_PER_SEASON);
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
// Усиления, добавляющие стрелы, открываются не сразу — чтобы начало игры
// не превращалось в ливень стрел.

export const UPGRADES: Choice<UpgradeId>[] = [
  {
    id: 'burst', icon: '⇈', title: 'Очередь', color: 0xff8a4f,
    desc: '+1 стрела подряд вперёд (до 3)',
    canTake: (r) => r.burst < MAX_BURST && r.level >= BURST_UNLOCK_LEVELS[r.burst - 1],
    apply: (r) => { r.burst += 1; },
  },
  {
    id: 'spread', icon: '⋎', title: 'Веер \\|/', color: 0xffc94f,
    desc: 'Каждый выстрел — три стрелы веером',
    canTake: (r) => !r.spread && r.level >= SPREAD_UNLOCK_LEVEL,
    apply: (r) => { r.spread = true; },
  },
  {
    id: 'ring', icon: '✺', title: 'Кольцо', color: 0xff5f8a,
    desc: 'Каждый третий залп — стрелы по кругу',
    canTake: (r) => !r.ring && r.level >= RING_UNLOCK_LEVEL,
    apply: (r) => { r.ring = true; },
  },
  {
    id: 'orbit', icon: '◎', title: 'Орбита', color: 0xffe07f,
    desc: '+1 стрела кружит вокруг: ранит врагов и сбивает снаряды',
    canTake: (r) => r.orbit < MAX_ORBIT,
    apply: (r) => { r.orbit += 1; },
  },
  {
    id: 'shield', icon: '⛨', title: 'Щит', color: 0x7fd8ff,
    desc: 'Блокирует удар и перезаряжается (каждый уровень — быстрее)',
    canTake: (r) => r.shield < 3,
    apply: (r) => { r.shield += 1; },
  },
  {
    id: 'thorns', icon: '✶', title: 'Шипы', color: 0xc0a080,
    desc: 'Враги, коснувшиеся тебя, получают урон',
    canTake: (r) => r.thorns < 3,
    apply: (r) => { r.thorns += 1; },
  },
  {
    id: 'crit', icon: '✧', title: 'Меткость', color: 0xff9fd0,
    desc: '+10% шанс двойного урона',
    canTake: (r) => r.critChance < 0.5,
    apply: (r) => { r.critChance += 0.1; },
  },
  {
    id: 'regen', icon: '✚', title: 'Регенерация', color: 0x7fff9f,
    desc: 'Восстанавливает 1 HP в секунду',
    canTake: (r) => r.regen < 3,
    apply: (r) => { r.regen += 1; },
  },
  {
    id: 'magnet', icon: '⊛', title: 'Магнит', color: 0x3fe0a8,
    desc: 'Опыт притягивается с вдвое большего расстояния',
    canTake: (r) => r.magnetMul < 2,
    apply: (r) => { r.magnetMul = 2; },
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
  ability('lightning', 'ϟ', 'Молния', 'Раз в пару секунд молния бьёт врага рядом', 0xfff07f),
  ability('explosive', '✹', 'Разрывные стрелы', 'Убитый враг взрывается и ранит соседей', 0xff8a3f),
  ability('frostArrows', '❅', 'Ледяные стрелы', 'Попадание замедляет врага', 0xbff0ff),
  ability('secondWind', '❦', 'Второе дыхание', 'Раз за уровень спасает от смерти', 0xffd0a0),
  ability('adrenaline', '⚕', 'Адреналин', 'Убийство восстанавливает выносливость', 0xe8ff7f),
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
    const saved = JSON.parse(raw) as Partial<RunState>;
    if (typeof saved.level !== 'number' || typeof saved.hp !== 'number') return null;
    // Сохранения старых версий могут не знать о новых полях — дополняем значениями по умолчанию.
    const base = newRun(saved.season ?? 0);
    return { ...base, ...saved, stats: { ...base.stats, ...saved.stats } };
  } catch {
    return null;
  }
}

export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
