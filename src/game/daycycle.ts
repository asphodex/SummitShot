import Phaser from 'phaser';
import {
  DAY_CYCLE_SECONDS,
  DUSK_EFFECT,
  DUSK_FROM,
  NIGHT_EFFECT,
  NIGHT_FROM,
  SKY_DUSK,
  SKY_NIGHT,
} from './constants';

/**
 * Смена суток: условия меняются от проведённого в игре времени.
 * За DAY_CYCLE_SECONDS день полностью сменяется ночью, ещё за столько же — обратно.
 * Время берётся из статистики забега, а она идёт только во время активной игры
 * (на паузе, при выборе усиления и в катсценах часы стоят).
 */

export type DayPhase = 'day' | 'dusk' | 'night';

/** Тёплые ("летние") враги слабеют к ночи, ледяные — крепнут. */
export type Temperature = 'warm' | 'cold' | 'neutral';

/** 0 — полдень, 1 — глубокая ночь. Треугольная волна: туда за 60 с и обратно за 60 с. */
export function nightness(playSeconds: number): number {
  const t = (playSeconds / DAY_CYCLE_SECONDS) % 2;
  return t < 1 ? t : 2 - t;
}

export function phaseOf(night: number): DayPhase {
  if (night >= NIGHT_FROM) return 'night';
  if (night >= DUSK_FROM) return 'dusk';
  return 'day';
}

/** На сколько сильнее/слабее становятся враги в этой фазе (0.2 = 20%). */
export function phaseEffect(phase: DayPhase): number {
  if (phase === 'night') return NIGHT_EFFECT;
  if (phase === 'dusk') return DUSK_EFFECT;
  return 0;
}

/** Множитель силы врага: <1 — ослаблен, >1 — усилен. */
export function strengthFor(temp: Temperature, phase: DayPhase): number {
  const effect = phaseEffect(phase);
  if (temp === 'warm') return 1 - effect;
  if (temp === 'cold') return 1 + effect;
  return 1;
}

export const PHASE_TITLE: Record<DayPhase, string> = {
  day: '☀ День',
  dusk: '◐ Закат',
  night: '☾ Ночь',
};

/** Ночь уже отступает — средняя фаза на обратном пути называется "Рассвет". */
export function isDawn(playSeconds: number): boolean {
  return (playSeconds / DAY_CYCLE_SECONDS) % 2 >= 1;
}

export function phaseTitle(phase: DayPhase, dawn: boolean): string {
  return phase === 'dusk' && dawn ? '◑ Рассвет' : PHASE_TITLE[phase];
}

/** Подпись для HUD: что сейчас происходит с врагами. */
export function phaseHint(phase: DayPhase, dawn: boolean): string {
  const pct = Math.round(phaseEffect(phase) * 100);
  const title = phaseTitle(phase, dawn);
  return phase === 'day' ? title : `${title} · тёплые −${pct}% · ледяные +${pct}%`;
}

/**
 * Цвет "небесной" заливки, которая умножается на картинку (MULTIPLY):
 * белый — без изменений, к закату тёплый оранжевый, к ночи тёмно-синий.
 */
export function skyColor(night: number): number {
  const day = Phaser.Display.Color.ValueToColor(0xffffff);
  const dusk = Phaser.Display.Color.ValueToColor(SKY_DUSK);
  const deep = Phaser.Display.Color.ValueToColor(SKY_NIGHT);
  const [from, to, k] = night <= 0.5 ? [day, dusk, night / 0.5] : [dusk, deep, (night - 0.5) / 0.5];
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, k * 100);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}
