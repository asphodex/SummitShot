import {
  BOSS_ARENA_HEIGHT,
  EXIT_Y,
  GAME_WIDTH,
  SAFE_EXIT,
  SAFE_START,
  SIDE_WALL,
} from './constants';
import type { EnemyKind, LevelPlan } from './season';

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

/** Минимальный зазор между препятствиями — чтобы всегда можно было пройти. */
const PASS_GAP = 64;
const BEAM_HALF_THICKNESS = 12;

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

  const contentTop = plan.isBoss ? BOSS_ARENA_HEIGHT + 120 : EXIT_Y + SAFE_EXIT;
  const contentBottom = plan.length - SAFE_START;
  const contentLength = Math.max(0, contentBottom - contentTop);

  if (plan.isBoss) {
    layout.arena = {
      top: 0,
      bottom: BOSS_ARENA_HEIGHT,
      gateY: EXIT_Y + 52,
      bossX: GAME_WIDTH / 2,
      bossY: 300,
    };
    // Колонны-укрытия на арене, симметрично.
    for (const [x, y] of [[250, 420], [GAME_WIDTH - 250, 420], [190, 560], [GAME_WIDTH - 190, 560]]) {
      layout.obstacles.push({ kind: 'rock', x, y, r: 24, scale: 0.9, variant: 2 });
    }
  }

  // Бассейны (вода / снег / зыбучий песок / лава).
  const poolCount = Math.round(contentLength / 1400) + rng.between(0, 1);
  for (let i = 0; i < poolCount; i++) {
    layout.pools.push({
      x: rng.between(layout.minX + 80, layout.maxX - 80),
      y: rng.between(contentTop, contentBottom),
      rx: rng.between(70, 115),
      ry: rng.between(38, 58),
    });
  }

  // Низкие брёвна — под ними нужно присесть или перекатиться.
  for (let y = contentBottom - 300; y > contentTop + 100; y -= rng.between(700, 1300)) {
    if (rng.frac() < 0.25 + plan.level * 0.015) {
      const len = rng.between(260, 440);
      const side = rng.between(0, 2);
      const x1 = side === 0 ? layout.minX - 20 : side === 1 ? layout.maxX - len + 20 : GAME_WIDTH / 2 - len / 2;
      layout.beams.push({ x1, x2: x1 + len, y });
    }
  }

  // Камни и деревья.
  const obstacleCount = Math.round((contentLength / 1000) * plan.obstacleDensity);
  for (let i = 0, tries = 0; i < obstacleCount && tries < obstacleCount * 12; tries++) {
    const isTree = rng.frac() < 0.45;
    const scale = isTree ? rng.realInRange(0.8, 1.15) : rng.realInRange(0.7, 1.25);
    const r = isTree ? 17 * scale : 25 * scale;
    const x = rng.between(layout.minX + 10, layout.maxX - 10);
    const y = rng.between(contentTop, contentBottom);
    if (!isFree(layout, x, y, r)) continue;
    layout.obstacles.push({ kind: isTree ? 'tree' : 'rock', x, y, r, scale, variant: rng.between(0, 2) });
    i++;
  }

  // Враги — равномерно по длине, иногда группками.
  const spawnTop = plan.isBoss ? BOSS_ARENA_HEIGHT + 200 : contentTop;
  for (let i = 0; i < plan.enemyCount; i++) {
    const band = (contentBottom - spawnTop) / Math.max(1, plan.enemyCount);
    const baseY = spawnTop + band * i + rng.between(0, Math.max(1, Math.floor(band)));
    const kind = rng.pick(plan.enemyKinds);
    for (let tries = 0; tries < 10; tries++) {
      const x = rng.between(layout.minX + 30, layout.maxX - 30);
      const y = baseY + rng.between(-60, 60);
      if (layout.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 40)) continue;
      layout.spawns.push({ kind, x, y });
      break;
    }
  }

  for (let y = 40; y < plan.length; y += 36) {
    layout.decals.push({
      x: rng.between(layout.minX - 20, layout.maxX + 20),
      y: y + rng.between(-18, 18),
      variant: rng.frac() < 0.15 ? 2 : rng.between(0, 1),
    });
  }

  return layout;
}

function isFree(layout: Layout, x: number, y: number, r: number): boolean {
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
