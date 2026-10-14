import * as C from './constants';

/**
 * Настройки баланса, которые можно менять без пересборки — в public/config.jsonc.
 * По умолчанию берутся из constants.ts; при старте игры перекрываются значениями из файла.
 * Некорректные или отсутствующие в файле значения остаются по умолчанию.
 */
export const TUNING = {
  dayCycle: {
    /** Пикселей подъёма на полную смену дня ночью (и столько же — обратно). */
    climbPerPhase: C.CLIMB_PER_PHASE,
    /** С какой "темноты" (0..1) начинается закат и ночь. */
    duskFrom: C.DUSK_FROM,
    nightFrom: C.NIGHT_FROM,
    /** Множители силы тёплых и ледяных врагов по фазам: <1 — слабее, >1 — сильнее. */
    phases: {
      day: { ...C.PHASE_STRENGTH.day },
      dusk: { ...C.PHASE_STRENGTH.dusk },
      night: { ...C.PHASE_STRENGTH.night },
    },
  },
  enemies: {
    hpPerLevel: C.ENEMY_HP_PER_LEVEL,
    hpTracking: C.ENEMY_HP_TRACKING,
    hpPerSeason: C.ENEMY_HP_PER_SEASON,
    bossBaseHp: C.BOSS_BASE_HP,
    bossHpBoostFirst: C.BOSS_HP_BOOST_FIRST,
    bossHpBoostLast: C.BOSS_HP_BOOST_LAST,
    finalBossHpMul: C.FINAL_BOSS_HP_MUL,
  },
  progression: {
    levelsPerUpgrade: C.LEVELS_PER_UPGRADE,
    burstUnlockLevels: [...C.BURST_UNLOCK_LEVELS],
    spreadUnlockLevel: C.SPREAD_UNLOCK_LEVEL,
    ringUnlockLevel: C.RING_UNLOCK_LEVEL,
  },
};

/** Эти значения не могут быть нулём: на них делим или от них зависит сила врага. */
const MUST_BE_POSITIVE = new Set(['climbPerPhase', 'levelsPerUpgrade', 'warm', 'cold']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValid(key: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return MUST_BE_POSITIVE.has(key) ? v > 0 : v >= 0;
}

/** Переносит из raw только известные ключи с корректными числами (массивы — той же длины). */
function merge(target: Record<string, unknown>, raw: unknown): void {
  if (!isObject(raw)) return;
  for (const key of Object.keys(target)) {
    const current = target[key];
    const value = raw[key];
    if (typeof current === 'number') {
      if (isValid(key, value)) target[key] = value;
    } else if (Array.isArray(current)) {
      if (Array.isArray(value) && value.length === current.length && value.every((v) => isValid(key, v))) {
        target[key] = [...value];
      }
    } else if (isObject(current)) {
      merge(current, value);
    }
  }
}

/** Убирает комментарии // до конца строки; внутри строк "..." ничего не трогает. */
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Читает public/config.jsonc. Без файла или с битым JSON игра идёт со значениями по умолчанию. */
export async function loadTuning(): Promise<void> {
  try {
    const res = await fetch(C.CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return;
    merge(TUNING as unknown as Record<string, unknown>, JSON.parse(stripComments(await res.text())));
  } catch {
    // ignore — значения по умолчанию
  }
  const day = TUNING.dayCycle;
  // Закат должен начинаться не позже ночи, обе границы — в пределах 0..1.
  if (!(day.duskFrom <= day.nightFrom && day.nightFrom <= 1)) {
    day.duskFrom = C.DUSK_FROM;
    day.nightFrom = C.NIGHT_FROM;
  }
}
