import Phaser from 'phaser';
import {
  BOSS_ARENA_HEIGHT,
  EXIT_Y,
  GAME_WIDTH,
  SAFE_EXIT,
  SAFE_START,
  SIDE_WALL,
  TUTORIAL_BEAM_Y,
  TUTORIAL_ROLL_BEAM_Y,
} from './constants';
import { ENEMY_DEFS } from './enemies';
import type { EnemyKind, LayoutStyle, LevelPlan } from './season';

/** Раскладка уровня — только данные, без графики. */

export interface ObstacleSpot {
  kind: 'rock' | 'tree';
  x: number;
  y: number;
  r: number;
  scale: number;
  variant: number;
}

export interface BeamSpot {
  x1: number;
  x2: number;
  y: number;
}

export interface PoolSpot {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface SpawnSpot {
  kind: EnemyKind;
  x: number;
  y: number;
}

export interface Arena {
  top: number;
  bottom: number;
  gateY: number;
  bossX: number;
  bossY: number;
}

export interface Layout {
  minX: number;
  maxX: number;
  obstacles: ObstacleSpot[];
  beams: BeamSpot[];
  pools: PoolSpot[];
  spawns: SpawnSpot[];
  decals: { x: number; y: number; variant: number }[];
  arena: Arena | null;
}

type Rng = Phaser.Math.RandomDataGenerator;

/** Минимальный зазор между препятствиями — чтобы всегда можно было пройти. */
const PASS_GAP = 64;
const BEAM_HALF_THICKNESS = 12;
/** Ширина прохода в стене из камней. */
const WALL_GAP = 120;
/** Минимальное расстояние между краями двух озёр. */
const POOL_GAP = 40;

/** Сколько бассейнов на 1000 px и насколько густо раскидывать одиночные камни/деревья. */
const STYLE_POOLS: Record<LayoutStyle, number> = { open: 0.7, groves: 0.5, walls: 0.4, wetlands: 3, canyon: 0.3 };
const STYLE_SCATTER: Record<LayoutStyle, number> = { open: 1, groves: 0.3, walls: 0.45, wetlands: 0.5, canyon: 0.25 };
const STYLE_BEAMS: Record<LayoutStyle, number> = { open: 1, groves: 1, walls: 0.5, wetlands: 2.2, canyon: 0.6 };

export const LAYOUT_MIN_X = SIDE_WALL + 16;
export const LAYOUT_MAX_X = GAME_WIDTH - SIDE_WALL - 16;

export function generateLayout(plan: LevelPlan): Layout {
  const rng = plan.rng;
  const layout: Layout = {
    minX: LAYOUT_MIN_X,
    maxX: LAYOUT_MAX_X,
    obstacles: [],
    beams: [],
    pools: [],
    spawns: [],
    decals: [],
    arena: null,
  };

  if (plan.isTutorial) return tutorialLayout(layout, rng, plan.length);

  const top = plan.isBoss ? BOSS_ARENA_HEIGHT + 120 : EXIT_Y + SAFE_EXIT;
  const bottom = plan.length - SAFE_START;
  const style = plan.layoutStyle;

  if (plan.isBoss) addArena(layout);

  addPools(layout, rng, top, bottom, STYLE_POOLS[style]);
  addBeams(layout, rng, top, bottom, plan.level, STYLE_BEAMS[style]);

  if (style === 'walls') addWalls(layout, rng, top, bottom);
  if (style === 'canyon') addCanyon(layout, rng, top, bottom);
  if (style === 'groves') addGroves(layout, rng, top, bottom);
  addScatter(layout, rng, top, bottom, plan.obstacleDensity * STYLE_SCATTER[style]);

  addSpawns(layout, rng, plan, plan.isBoss ? BOSS_ARENA_HEIGHT + 200 : top, bottom);
  addDecals(layout, rng, plan.length);
  return layout;
}

/** Обучение: пустая тропа и два бревна во всю ширину. Мишени ставит сценарий обучения. */
function tutorialLayout(layout: Layout, rng: Rng, length: number): Layout {
  for (const y of [TUTORIAL_BEAM_Y, TUTORIAL_ROLL_BEAM_Y]) {
    layout.beams.push({ x1: layout.minX - 30, x2: layout.maxX + 30, y });
  }
  for (const [x, y] of [[layout.minX + 40, 1050], [layout.maxX - 40, 900], [layout.minX + 60, 380], [layout.maxX - 50, 300]]) {
    layout.obstacles.push({ kind: rng.frac() < 0.5 ? 'tree' : 'rock', x, y, r: 18, scale: 0.9, variant: 1 });
  }
  addDecals(layout, rng, length);
  return layout;
}

function addArena(layout: Layout): void {
  layout.arena = { top: 0, bottom: BOSS_ARENA_HEIGHT, gateY: EXIT_Y + 52, bossX: GAME_WIDTH / 2, bossY: 300 };
  // Колонны-укрытия на арене, симметрично.
  for (const [x, y] of [[250, 420], [GAME_WIDTH - 250, 420], [190, 560], [GAME_WIDTH - 190, 560]]) {
    layout.obstacles.push({ kind: 'rock', x, y, r: 24, scale: 0.9, variant: 2 });
  }
}

/** Бассейны: вода / снег / зыбучий песок / лава. */
function addPools(layout: Layout, rng: Rng, top: number, bottom: number, perThousand: number): void {
  const count = Math.round(((bottom - top) / 1000) * perThousand) + rng.between(0, 1);
  for (let i = 0, tries = 0; i < count && tries < count * 15; tries++) {
    const pool = {
      x: rng.between(layout.minX + 80, layout.maxX - 80),
      y: rng.between(top, bottom),
      rx: rng.between(70, 115),
      ry: rng.between(38, 58),
    };
    // Озёра не накладываются друг на друга.
    const overlaps = layout.pools.some((p) =>
      Math.abs(p.x - pool.x) < p.rx + pool.rx + POOL_GAP && Math.abs(p.y - pool.y) < p.ry + pool.ry + POOL_GAP);
    if (overlaps) continue;
    layout.pools.push(pool);
    i++;
  }
}

/** Точка (с радиусом r) задевает озеро — там нельзя ставить камни, деревья и брёвна. */
function inPool(layout: Layout, x: number, y: number, r: number): boolean {
  return layout.pools.some((p) => {
    const nx = (x - p.x) / (p.rx + r + 10);
    const ny = (y - p.y) / (p.ry + r + 10);
    return nx * nx + ny * ny < 1;
  });
}

/** Низкие брёвна — под ними нужно присесть или перекатиться. */
function addBeams(layout: Layout, rng: Rng, top: number, bottom: number, level: number, mul: number): void {
  for (let y = bottom - 300; y > top + 100; y -= rng.between(600, 1200)) {
    if (rng.frac() > (0.25 + level * 0.015) * mul) continue;
    const len = rng.between(260, 440);
    const side = rng.between(0, 2);
    const x1 = side === 0 ? layout.minX - 20 : side === 1 ? layout.maxX - len + 20 : GAME_WIDTH / 2 - len / 2;
    const overPool = layout.pools.some((p) => p.x + p.rx > x1 - 20 && p.x - p.rx < x1 + len + 20 && Math.abs(p.y - y) < p.ry + 40);
    if (overPool) continue;
    layout.beams.push({ x1, x2: x1 + len, y });
  }
}

function nearBeam(layout: Layout, y: number, margin: number): boolean {
  return layout.beams.some((b) => Math.abs(b.y - y) < margin);
}

function pushRock(layout: Layout, rng: Rng, x: number, y: number, scale: number): void {
  if (inPool(layout, x, y, 25 * scale)) return;
  layout.obstacles.push({ kind: 'rock', x, y, r: 25 * scale, scale, variant: rng.between(0, 2) });
}

/** "Стены": поперечные ряды камней с 1–2 проходами. */
function addWalls(layout: Layout, rng: Rng, top: number, bottom: number): void {
  for (let y = bottom - 200; y > top + 80; y -= rng.between(420, 560)) {
    if (nearBeam(layout, y, 90)) continue;
    const gaps = rng.frac() < 0.5 ? 1 : 2;
    const gapXs = Array.from({ length: gaps }, () => rng.between(layout.minX + 80, layout.maxX - 80));
    for (let x = layout.minX + 10; x <= layout.maxX - 10; x += 44) {
      if (gapXs.some((g) => Math.abs(g - x) < WALL_GAP / 2 + 24)) continue;
      pushRock(layout, rng, x, y + rng.between(-6, 6), rng.realInRange(0.85, 1.05));
    }
  }
}

/** "Каньон": извилистый коридор между скалами. */
function addCanyon(layout: Layout, rng: Rng, top: number, bottom: number): void {
  const phase = rng.frac() * Math.PI * 2;
  const mid = (layout.minX + layout.maxX) / 2;
  for (let y = bottom; y > top; y -= 58) {
    if (nearBeam(layout, y, 50)) continue;
    const cx = mid + Math.sin(y / 380 + phase) * 170;
    const half = 150 + Math.sin(y / 230) * 40;
    for (const side of [-1, 1]) {
      const edge = cx + side * (half + 24);
      if (edge < layout.minX + 10 || edge > layout.maxX - 10) continue;
      pushRock(layout, rng, edge, y, rng.realInRange(0.85, 1.1));
      // Остальное пространство до стены засаживаем деревьями.
      const wall = side < 0 ? layout.minX : layout.maxX;
      const between = (edge + wall) / 2;
      if (Math.abs(wall - edge) > 90 && rng.frac() < 0.7 && !inPool(layout, between, y, 20)) {
        const scale = rng.realInRange(0.8, 1.1);
        layout.obstacles.push({ kind: 'tree', x: between, y: y + rng.between(-15, 15), r: 17 * scale, scale, variant: 0 });
      }
    }
  }
}

/** "Рощи": плотные группы деревьев и камней с открытыми полянами между ними. */
function addGroves(layout: Layout, rng: Rng, top: number, bottom: number): void {
  for (let y = bottom - 100; y > top + 60; y -= rng.between(300, 450)) {
    const cx = rng.between(layout.minX + 110, layout.maxX - 110);
    const members = rng.between(4, 7);
    for (let i = 0, tries = 0; i < members && tries < 30; tries++) {
      const isTree = rng.frac() < 0.65;
      const scale = rng.realInRange(0.8, 1.15);
      const r = isTree ? 17 * scale : 25 * scale;
      const x = cx + rng.between(-110, 110);
      const yy = y + rng.between(-70, 70);
      if (layout.obstacles.some((o) => Math.hypot(o.x - x, o.y - yy) < o.r + r + 8)) continue;
      if (nearBeam(layout, yy, 50) || inPool(layout, x, yy, r)) continue;
      layout.obstacles.push({ kind: isTree ? 'tree' : 'rock', x, y: yy, r, scale, variant: rng.between(0, 2) });
      i++;
    }
  }
}

/** Одиночные камни и деревья с гарантированным проходом. */
function addScatter(layout: Layout, rng: Rng, top: number, bottom: number, density: number): void {
  const count = Math.round(((bottom - top) / 1000) * density);
  for (let i = 0, tries = 0; i < count && tries < count * 12; tries++) {
    const isTree = rng.frac() < 0.45;
    const scale = isTree ? rng.realInRange(0.8, 1.15) : rng.realInRange(0.7, 1.25);
    const r = isTree ? 17 * scale : 25 * scale;
    const x = rng.between(layout.minX + 10, layout.maxX - 10);
    const y = rng.between(top, bottom);
    if (!isFree(layout, x, y, r)) continue;
    layout.obstacles.push({ kind: isTree ? 'tree' : 'rock', x, y, r, scale, variant: rng.between(0, 2) });
    i++;
  }
}

/** Враги: россыпью или группами; стайные (мошкара, жуки) — всегда стаей. */
function addSpawns(layout: Layout, rng: Rng, plan: LevelPlan, top: number, bottom: number): void {
  const groups = plan.packs ? Math.ceil(plan.enemyCount / 3) : plan.enemyCount;
  const band = (bottom - top) / Math.max(1, groups);
  let left = plan.enemyCount;
  for (let g = 0; g < groups && left > 0; g++) {
    const cy = top + band * g + rng.between(0, Math.max(1, Math.floor(band)));
    const cx = rng.between(layout.minX + 60, layout.maxX - 60);
    const size = plan.packs ? Math.min(left, rng.between(2, 4)) : 1;
    left -= size;
    for (let i = 0; i < size; i++) {
      const kind = rng.pick(plan.enemyKinds);
      const spread = plan.packs ? 70 : 300;
      placeEnemy(layout, rng, kind, cx + rng.between(-spread, spread), cy + rng.between(-60, 60));
    }
  }
}

function placeEnemy(layout: Layout, rng: Rng, kind: EnemyKind, x0: number, y0: number): void {
  const pack = ENEMY_DEFS[kind].pack;
  for (let tries = 0; tries < 10; tries++) {
    const x = Phaser.Math.Clamp(x0 + rng.between(-40, 40) * tries, layout.minX + 30, layout.maxX - 30);
    const y = y0 + rng.between(-30, 30) * tries;
    if (layout.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 40)) continue;
    for (let i = 0; i < pack; i++) {
      const a = (i / pack) * Math.PI * 2;
      layout.spawns.push({ kind, x: x + (pack > 1 ? Math.cos(a) * 26 : 0), y: y + (pack > 1 ? Math.sin(a) * 20 : 0) });
    }
    return;
  }
}

function addDecals(layout: Layout, rng: Rng, length: number): void {
  for (let y = 40; y < length; y += 36) {
    layout.decals.push({
      x: rng.between(layout.minX - 20, layout.maxX + 20),
      y: y + rng.between(-18, 18),
      variant: rng.frac() < 0.15 ? 2 : rng.between(0, 1),
    });
  }
}

function isFree(layout: Layout, x: number, y: number, r: number): boolean {
  if (inPool(layout, x, y, r)) return false;
  const wallGapLeft = x - r - layout.minX;
  const wallGapRight = layout.maxX - (x + r);
  if ((wallGapLeft > 0 && wallGapLeft < PASS_GAP) || (wallGapRight > 0 && wallGapRight < PASS_GAP)) return false;
  for (const o of layout.obstacles) {
    if (Math.hypot(o.x - x, o.y - y) < o.r + r + PASS_GAP) return false;
  }
  for (const b of layout.beams) {
    if (x + r > b.x1 - 40 && x - r < b.x2 + 40 && Math.abs(y - b.y) < r + BEAM_HALF_THICKNESS + PASS_GAP) return false;
  }
  return true;
}

export { BEAM_HALF_THICKNESS };
