import Phaser from 'phaser';
import { SKY_DUSK, SKY_NIGHT } from './constants';
import { TUNING } from './tuning';

/**
 * Смена суток: условия меняются по мере подъёма в гору.
 * За climbPerPhase пикселей подъёма день полностью сменяется ночью, ещё за столько же — обратно.
 * Учитывается только самая высокая точка уровня, так что отступлением день не вернуть.
 * Длина и границы фаз, сила врагов по фазам — в public/config.json (см. tuning.ts).
 */

export type DayPhase = 'day' | 'dusk' | 'night';

/** Тёплые ("летние") враги слабеют к ночи, ледяные — крепнут. */
export type Temperature = 'warm' | 'cold' | 'neutral';

/** 0 — полдень, 1 — глубокая ночь. Треугольная волна: к ночи за climbPerPhase и обратно за столько же. */
export function nightness(climb: number): number {
  const t = (climb / TUNING.dayCycle.climbPerPhase) % 2;
  return t < 1 ? t : 2 - t;
}

export function phaseOf(night: number): DayPhase {
  if (night >= TUNING.dayCycle.nightFrom) return 'night';
  if (night >= TUNING.dayCycle.duskFrom) return 'dusk';
  return 'day';
}

/** Множитель силы врага: <1 — ослаблен, >1 — усилен. */
export function strengthFor(temp: Temperature, phase: DayPhase): number {
  return temp === 'neutral' ? 1 : TUNING.dayCycle.phases[phase][temp];
}

export const PHASE_TITLE: Record<DayPhase, string> = {
  day: '☀ День',
  dusk: '◐ Закат',
  night: '☾ Ночь',
};

/** Ночь уже отступает — средняя фаза на обратном пути называется "Рассвет". */
export function isDawn(climb: number): boolean {
  return (climb / TUNING.dayCycle.climbPerPhase) % 2 >= 1;
}

export function phaseTitle(phase: DayPhase, dawn: boolean): string {
  return phase === 'dusk' && dawn ? '◑ Рассвет' : PHASE_TITLE[phase];
}

function percent(mul: number): string {
  const pct = Math.round((mul - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `−${-pct}%`;
}

/** Что фаза делает с врагами, например "тёплые −20% · ледяные +20%"; пусто, если ничего. */
export function phaseEffectText(phase: DayPhase): string {
  const { warm, cold } = TUNING.dayCycle.phases[phase];
  if (warm === 1 && cold === 1) return '';
  return `тёплые ${percent(warm)} · ледяные ${percent(cold)}`;
}

/** Подпись для HUD: название фазы и что сейчас происходит с врагами. */
export function phaseHint(phase: DayPhase, dawn: boolean): string {
  const title = phaseTitle(phase, dawn);
  const effect = phaseEffectText(phase);
  return effect ? `${title} · ${effect}` : title;
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
