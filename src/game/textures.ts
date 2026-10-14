import Phaser from 'phaser';
import type { Biome, EnemyKind } from './season';

/**
 * Вся графика рисуется кодом на canvas — без файлов-ассетов.
 * Стиль: low-poly грани со светом сверху-слева и мягкие тени, как в PEAK.
 */

type Ctx = CanvasRenderingContext2D;
type Point = [number, number];

const LIGHT_ANGLE = Math.atan2(-1, -0.8);
const WOOD = '#9a6a42';
const WOOD_DARK = '#6a4428';
const WOOD_LIGHT = '#c48f5c';

// --- Цвета -------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function toColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// --- Базовые кисти --------------------------------------------------------------

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function poly(ctx: Ctx, pts: Point[], fill: string): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Цвет грани в зависимости от того, смотрит ли она на свет. */
function shade(angle: number, light: string, mid: string, dark: string): string {
  const t = (Math.cos(angle - LIGHT_ANGLE) + 1) / 2;
  return t > 0.5 ? mix(mid, light, (t - 0.5) * 2) : mix(dark, mid, t * 2);
}

/** Low-poly "камень": выдавленный многоугольник с гранями. */
function lowPoly(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  height: number,
  light: string,
  mid: string,
  dark: string,
): void {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const r = 0.82 + Math.random() * 0.2;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  for (let k = height; k > 0; k -= 2) {
    poly(ctx, pts.map(([x, y]) => [x, y + k] as Point), mix(dark, '#000000', 0.15 * (k / Math.max(1, height))));
  }
  const apex: Point = [cx - rx * 0.22, cy - ry * 0.28];
  for (let i = 0; i < sides; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % sides];
    const angle = Math.atan2((a[1] + b[1]) / 2 - cy, (a[0] + b[0]) / 2 - cx);
    poly(ctx, [apex, a, b], shade(angle, light, mid, dark));
  }
}

// --- Общие текстуры ---------------------------------------------------------------

export function createCommonTextures(scene: Phaser.Scene): void {
  make(scene, 'shadow', 64, 32, (ctx) => {
    const g = ctx.createRadialGradient(32, 16, 2, 32, 16, 32);
    g.addColorStop(0, 'rgba(20,10,30,0.55)');
    g.addColorStop(0.6, 'rgba(20,10,30,0.35)');
    g.addColorStop(1, 'rgba(20,10,30,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  make(scene, 'soft', 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });

  make(scene, 'dot', 12, 12, (ctx) => ellipse(ctx, 6, 6, 5.5, 5.5, '#ffffff'));

  make(scene, 'leaf', 14, 8, (ctx) => {
    ellipse(ctx, 7, 4, 6.5, 3.2, '#ffffff');
  });

  make(scene, 'spark', 20, 20, (ctx) => {
    poly(ctx, [[10, 0], [12.5, 7.5], [20, 10], [12.5, 12.5], [10, 20], [7.5, 12.5], [0, 10], [7.5, 7.5]], '#ffffff');
  });

  make(scene, 'ring', 128, 128, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.stroke();
  });

  make(scene, 'disc', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

  make(scene, 'vignette', 480, 320, (ctx) => {
    const g = ctx.createRadialGradient(240, 170, 120, 240, 160, 320);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(20,8,30,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 320);
  });

  make(scene, 'hurt', 480, 320, (ctx) => {
    const g = ctx.createRadialGradient(240, 160, 90, 240, 160, 300);
    g.addColorStop(0, 'rgba(255,40,40,0)');
    g.addColorStop(1, 'rgba(255,30,50,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 320);
  });

  make(scene, 'fog', 8, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
  });

  make(scene, 'player', 44, 54, drawScout);

  make(scene, 'bow', 34, 34, (ctx) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3a2416';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(8, 17, 15, -1.2, 1.2);
    ctx.stroke();
    ctx.strokeStyle = WOOD_LIGHT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(8, 17, 15, -1.2, 1.2);
    ctx.stroke();
    ctx.strokeStyle = '#f5eedd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8 + Math.cos(-1.2) * 15, 17 + Math.sin(-1.2) * 15);
    ctx.lineTo(8 + Math.cos(1.2) * 15, 17 + Math.sin(1.2) * 15);
    ctx.stroke();
  });

  make(scene, 'arrow', 36, 10, (ctx) => {
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(4, 4, 26, 2);
    ctx.fillStyle = '#f1e9d8';
    ctx.fillRect(5, 4.2, 22, 1.2);
    poly(ctx, [[36, 5], [28, 1], [29, 5], [28, 9]], '#d8e2ea');
    poly(ctx, [[36, 5], [29, 5], [28, 9]], '#8796a8');
    poly(ctx, [[0, 1], [9, 4], [5, 4]], '#ff6b5a');
    poly(ctx, [[0, 9], [9, 6], [5, 6]], '#ff6b5a');
  });

  make(scene, 'shot_low', 26, 26, (ctx) => {
    const g = ctx.createRadialGradient(13, 13, 2, 13, 13, 13);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#d27bff');
    g.addColorStop(0.75, '#7a2fd0');
    g.addColorStop(1, 'rgba(90,20,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 26, 26);
  });

  make(scene, 'shot_high', 34, 34, (ctx) => {
    const g = ctx.createRadialGradient(17, 17, 2, 17, 17, 17);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.35, '#ffcf4a');
    g.addColorStop(0.7, '#ff7a1f');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 34, 34);
  });

  make(scene, 'orb', 18, 18, (ctx) => {
    poly(ctx, [[9, 1], [16, 9], [9, 17], [2, 9]], '#3fd0a0');
    poly(ctx, [[9, 1], [16, 9], [9, 9]], '#9cffd6');
    poly(ctx, [[9, 1], [2, 9], [9, 9]], '#6af0bf');
    poly(ctx, [[9, 17], [16, 9], [9, 9]], '#1f9a7a');
  });

  make(scene, 'flag', 80, 120, (ctx) => {
    lowPoly(ctx, 40, 104, 30, 12, 8, 8, '#d9d9d9', '#a8a8a8', '#6f6f6f');
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(38, 10, 4, 92);
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(38, 10, 2, 92);
    poly(ctx, [[42, 12], [76, 22], [42, 36]], '#ff5a4a');
    poly(ctx, [[42, 24], [76, 22], [42, 36]], '#d83a3a');
    ellipse(ctx, 40, 9, 4, 4, '#ffd25f');
  });

  make(scene, 'stake', 30, 76, (ctx) => {
    poly(ctx, [[3, 14], [15, 0], [27, 14], [27, 76], [3, 76]], WOOD);
    poly(ctx, [[3, 14], [15, 0], [15, 76], [3, 76]], WOOD_LIGHT);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(3, 40, 24, 5);
  });

  make(scene, 'post', 26, 40, (ctx) => {
    ellipse(ctx, 13, 34, 11, 5, WOOD_DARK);
    ctx.fillStyle = WOOD;
    ctx.fillRect(4, 8, 18, 26);
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(4, 8, 7, 26);
    ellipse(ctx, 13, 8, 9, 4, '#d9b080');
  });

  make(scene, 'log', 256, 34, (ctx) => {
    roundRect(ctx, 2, 4, 252, 26, 12, WOOD_DARK);
    roundRect(ctx, 2, 4, 252, 16, 10, WOOD);
    roundRect(ctx, 6, 6, 244, 6, 3, WOOD_LIGHT);
    ctx.strokeStyle = 'rgba(60,30,10,0.4)';
    ctx.lineWidth = 1.5;
    for (let x = 20; x < 240; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x + 14, 24);
      ctx.stroke();
    }
    ellipse(ctx, 248, 17, 6, 12, '#d9b080');
    ellipse(ctx, 248, 17, 3, 6, WOOD);
  });

  for (const kind of Object.keys(ENEMY_COLORS) as EnemyKind[]) {
    make(scene, kind, 64, 64, (ctx) => drawEnemy(ctx, kind, ENEMY_COLORS[kind]));
  }

  make(scene, 'heli', 210, 120, drawHeli);
  make(scene, 'rotor', 240, 240, (ctx) => {
    // Размытый диск вращения + светлые лопасти — видно и на тёмной лаве.
    ctx.globalAlpha = 0.18;
    ellipse(ctx, 120, 120, 118, 118, '#ffffff');
    ctx.globalAlpha = 0.85;
    for (const a of [0.3, 0.3 + Math.PI / 2]) {
      ctx.save();
      ctx.translate(120, 120);
      ctx.rotate(a);
      roundRect(ctx, -118, -6, 236, 12, 6, '#e8e8f0');
      roundRect(ctx, -118, 1, 236, 5, 3, '#9a9aa8');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ellipse(ctx, 120, 120, 9, 9, '#2a2a30');
  });

  // Холмик земли над кротом (тонируется под цвет биома).
  make(scene, 'mound', 48, 28, (ctx) => {
    lowPoly(ctx, 24, 16, 20, 9, 7, 4, '#ffffff', '#d8d8d8', '#a0a0a0');
    for (const [x, y] of [[10, 22], [38, 21], [30, 25]]) ellipse(ctx, x, y, 3, 2, '#b8b8b8');
  });
}

/** Спасательный вертолёт: красно-белый, как в горных спасслужбах. */
function drawHeli(ctx: Ctx): void {
  // Хвост.
  roundRect(ctx, 115, 46, 80, 12, 6, '#b8322c');
  roundRect(ctx, 115, 46, 80, 5, 3, '#e8453c');
  poly(ctx, [[180, 50], [200, 22], [206, 26], [196, 54]], '#e8453c');
  ellipse(ctx, 198, 56, 9, 9, 'rgba(60,60,70,0.5)');
  // Полозья.
  ctx.strokeStyle = '#3a3a44';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const y of [104, 112]) {
    ctx.beginPath();
    ctx.moveTo(22, y);
    ctx.lineTo(118, y);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  for (const x of [45, 95]) {
    ctx.beginPath();
    ctx.moveTo(x, 84);
    ctx.lineTo(x, 110);
    ctx.stroke();
  }
  // Корпус.
  roundRect(ctx, 18, 26, 120, 66, 30, '#b8322c');
  roundRect(ctx, 18, 26, 120, 52, 28, '#e8453c');
  roundRect(ctx, 30, 60, 108, 9, 4, '#ffffff');
  ellipse(ctx, 46, 48, 22, 18, '#3a5a7a');
  ellipse(ctx, 42, 43, 16, 12, '#8fd0ff');
  ellipse(ctx, 37, 39, 6, 4, '#ffffff');
  roundRect(ctx, 76, 36, 30, 22, 4, '#3a5a7a');
  roundRect(ctx, 78, 38, 26, 10, 3, '#8fd0ff');
  // Втулка винта.
  roundRect(ctx, 68, 14, 16, 14, 4, '#3a3a44');
}

// --- Шрифт цифр урона -------------------------------------------------------------

/** Символы растрового шрифта для цифр урона (x — "отскок от панциря"). */
export const DAMAGE_FONT_CHARS = '0123456789+-!x';
const DAMAGE_CELL_W = 15;
const DAMAGE_CELL_H = 28;

/**
 * Растровый шрифт для всплывающих цифр: рисуется один раз, а каждая цифра —
 * это кусочек общей текстуры. Обычный Text перерисовывал бы canvas на каждом попадании.
 */
export function createDamageFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists('dmg')) return;
  make(scene, 'dmgfont', DAMAGE_CELL_W * DAMAGE_FONT_CHARS.length, DAMAGE_CELL_H, (ctx) => {
    ctx.font = 'bold 21px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    [...DAMAGE_FONT_CHARS].forEach((ch, i) => {
      const x = i * DAMAGE_CELL_W + DAMAGE_CELL_W / 2;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#1a1020';
      ctx.strokeText(ch, x, DAMAGE_CELL_H / 2 + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, x, DAMAGE_CELL_H / 2 + 1);
    });
  });
  scene.cache.bitmapFont.add('dmg', Phaser.GameObjects.RetroFont.Parse(scene, {
    image: 'dmgfont',
    width: DAMAGE_CELL_W,
    height: DAMAGE_CELL_H,
    chars: DAMAGE_FONT_CHARS,
    charsPerRow: DAMAGE_FONT_CHARS.length,
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 0,
  }));
}

// --- Персонаж -------------------------------------------------------------------

/** Скаут со спины: шляпа, шарф и огромный рюкзак — как в PEAK. */
function drawScout(ctx: Ctx): void {
  roundRect(ctx, 13, 40, 7, 12, 3, '#3b3f5c');
  roundRect(ctx, 24, 40, 7, 12, 3, '#3b3f5c');
  ellipse(ctx, 22, 34, 14, 12, '#2f8fa6');
  ellipse(ctx, 18, 31, 8, 7, '#4fb3c8');
  roundRect(ctx, 8, 28, 6, 12, 3, '#2f8fa6');
  roundRect(ctx, 30, 28, 6, 12, 3, '#2f8fa6');
  // Рюкзак.
  roundRect(ctx, 11, 22, 22, 22, 6, '#d9682a');
  roundRect(ctx, 11, 22, 22, 11, 6, '#f28c38');
  roundRect(ctx, 14, 35, 16, 6, 2, '#b04f1f');
  roundRect(ctx, 9, 17, 26, 8, 4, '#e8dcc0');
  roundRect(ctx, 9, 17, 26, 3, 2, '#fff6e0');
  // Шарф и голова.
  ellipse(ctx, 22, 17, 9, 3, '#e04a4a');
  ellipse(ctx, 22, 11, 8, 8, '#f2c29b');
  ellipse(ctx, 22, 8, 12, 4.5, '#6f7a3a');
  ellipse(ctx, 22, 6, 7.5, 5, '#8a9a4a');
  ellipse(ctx, 20, 4.5, 4, 2, '#a8b860');
}

// --- Враги ------------------------------------------------------------------------

interface CreatureColors {
  main: string;
  dark: string;
  light: string;
  extra: string;
}

const ENEMY_COLORS: Record<EnemyKind, CreatureColors> = {
  crab: { main: '#ff6f4f', dark: '#b8352f', light: '#ffa77f', extra: '#ffffff' },
  spitter: { main: '#b04fd0', dark: '#6a2a8a', light: '#e08aff', extra: '#4fae5a' },
  bat: { main: '#5a3a7a', dark: '#2f1f4a', light: '#8a6ab0', extra: '#ffd23f' },
  charger: { main: '#f0ece2', dark: '#a8a092', light: '#ffffff', extra: '#7a5a3a' },
  shooter: { main: '#3a3248', dark: '#1c1726', light: '#5f5478', extra: '#ff5fd0' },
  blob: { main: '#ff7a2f', dark: '#b8351f', light: '#ffcf5f', extra: '#2a1a1a' },
  gnat: { main: '#6aa83a', dark: '#2f5a1f', light: '#b8f07a', extra: '#ff3f3f' },
  turret: { main: '#8a8f9a', dark: '#565b66', light: '#c0c6d0', extra: '#5fe8ff' },
  bomber: { main: '#2a2430', dark: '#c0392b', light: '#5a5068', extra: '#ffb03f' },
  turtle: { main: '#4f9a5a', dark: '#2f6a3a', light: '#8fd08a', extra: '#c8b07a' },
  healer: { main: '#e0453f', dark: '#9a2a2a', light: '#ff8a7a', extra: '#f0e0c0' },
  sniper: { main: '#3f6a3a', dark: '#24401f', light: '#6a9a5a', extra: '#ffe03f' },
  mole: { main: '#7a5a48', dark: '#4a3428', light: '#e8a8a0', extra: '#ff8aa0' },
};

/** Основной цвет врага — для частиц при смерти. */
export function enemyTint(kind: EnemyKind | 'boss'): number {
  return kind === 'boss' ? 0xffd23f : toColor(ENEMY_COLORS[kind].main);
}

function eyes(ctx: Ctx, x: number, y: number, gap: number, r: number, pupil = '#1a1020'): void {
  ellipse(ctx, x - gap, y, r, r * 1.1, '#ffffff');
  ellipse(ctx, x + gap, y, r, r * 1.1, '#ffffff');
  ellipse(ctx, x - gap, y + r * 0.25, r * 0.55, r * 0.6, pupil);
  ellipse(ctx, x + gap, y + r * 0.25, r * 0.55, r * 0.6, pupil);
}

/** Рисует существо в квадрате 64x64 (босс использует ту же функцию в масштабе). */
function drawEnemy(ctx: Ctx, kind: EnemyKind, c: CreatureColors): void {
  ctx.lineCap = 'round';
  switch (kind) {
    case 'crab': {
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(32 + s * 10, 40 + i * 3);
          ctx.lineTo(32 + s * 22, 44 + i * 5);
          ctx.stroke();
        }
      }
      ellipse(ctx, 32, 40, 18, 12, c.dark);
      ellipse(ctx, 32, 37, 17, 10, c.main);
      ellipse(ctx, 28, 34, 9, 4, c.light);
      for (const s of [-1, 1]) {
        ellipse(ctx, 32 + s * 21, 28, 8, 7, c.dark);
        ellipse(ctx, 32 + s * 21, 27, 7, 6, c.main);
        poly(ctx, [[32 + s * 21, 22], [32 + s * 26, 18], [32 + s * 24, 27]], c.light);
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(32 + s * 5, 30);
        ctx.lineTo(32 + s * 6, 22);
        ctx.stroke();
      }
      eyes(ctx, 32, 21, 6, 3.5);
      break;
    }
    case 'spitter': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        poly(ctx, [[32, 46], [32 + Math.cos(a - 0.3) * 14, 46 + Math.sin(a - 0.3) * 7], [32 + Math.cos(a) * 26, 46 + Math.sin(a) * 13]], i % 2 ? c.extra : mix(c.extra, '#000000', 0.25));
      }
      ctx.fillStyle = mix(c.extra, '#000000', 0.3);
      ctx.fillRect(29, 30, 6, 16);
      ellipse(ctx, 32, 26, 15, 14, c.dark);
      ellipse(ctx, 32, 24, 14, 12.5, c.main);
      ellipse(ctx, 27, 20, 5, 3.5, c.light);
      ellipse(ctx, 32, 18, 7, 5, c.dark);
      ellipse(ctx, 32, 18, 4.5, 3, '#2a0a3a');
      eyes(ctx, 32, 29, 6, 3);
      break;
    }
    case 'bat': {
      for (const s of [-1, 1]) {
        poly(ctx, [[32 + s * 6, 26], [32 + s * 30, 16], [32 + s * 26, 30], [32 + s * 20, 26], [32 + s * 14, 36]], c.dark);
        poly(ctx, [[32 + s * 6, 26], [32 + s * 30, 16], [32 + s * 22, 24]], c.main);
      }
      ellipse(ctx, 32, 30, 10, 11, c.main);
      ellipse(ctx, 30, 26, 5, 4, c.light);
      poly(ctx, [[25, 22], [27, 12], [31, 21]], c.main);
      poly(ctx, [[39, 22], [37, 12], [33, 21]], c.main);
      ellipse(ctx, 28, 29, 2.8, 2.8, c.extra);
      ellipse(ctx, 36, 29, 2.8, 2.8, c.extra);
      break;
    }
    case 'charger': {
      ellipse(ctx, 32, 40, 20, 14, c.dark);
      for (let i = 0; i < 7; i++) {
        ellipse(ctx, 18 + i * 4.6, 34 + (i % 2) * 3, 7, 7, i % 2 ? c.main : c.light);
      }
      ellipse(ctx, 32, 24, 9, 10, '#4a3a3a');
      ellipse(ctx, 32, 22, 7, 7, '#6a5050');
      ctx.strokeStyle = c.extra;
      ctx.lineWidth = 5;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(32 + s * 10, 18, 7, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2.6 : -Math.PI * 1.6, s < 0);
        ctx.stroke();
      }
      ellipse(ctx, 28, 24, 2, 2, '#ffde5f');
      ellipse(ctx, 36, 24, 2, 2, '#ffde5f');
      break;
    }
    case 'shooter': {
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(32 + s * 8, 34 + i * 4);
          ctx.lineTo(32 + s * 20, 38 + i * 6);
          ctx.stroke();
        }
        ellipse(ctx, 32 + s * 16, 22, 6, 5, c.main);
        poly(ctx, [[32 + s * 14, 18], [32 + s * 22, 12], [32 + s * 20, 20]], c.light);
      }
      ellipse(ctx, 32, 38, 13, 11, c.dark);
      ellipse(ctx, 32, 36, 12, 9, c.main);
      ellipse(ctx, 29, 33, 5, 3, c.light);
      // Хвост над спиной.
      for (let i = 0; i < 4; i++) ellipse(ctx, 32, 48 - i * 1 - i * 0, 6 - i, 5 - i, i % 2 ? c.main : c.light);
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(32, 46);
      ctx.quadraticCurveTo(52, 44, 44, 26);
      ctx.stroke();
      ellipse(ctx, 43, 24, 4.5, 4.5, c.extra);
      eyes(ctx, 32, 27, 4, 2.5, '#ff5fd0');
      break;
    }
    case 'blob': {
      ellipse(ctx, 32, 40, 20, 15, c.dark);
      ellipse(ctx, 32, 37, 19, 15, c.main);
      ellipse(ctx, 26, 30, 8, 5, c.light);
      ctx.strokeStyle = mix(c.dark, '#000000', 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(18, 42);
      ctx.lineTo(24, 38);
      ctx.lineTo(22, 46);
      ctx.moveTo(44, 40);
      ctx.lineTo(40, 45);
      ctx.stroke();
      eyes(ctx, 32, 36, 6, 3.5, c.extra);
      break;
    }
    case 'gnat': {
      // Рисуем крупнее, чтобы мелкую мошкару было видно.
      ctx.translate(32, 32);
      ctx.scale(1.5, 1.5);
      ctx.translate(-32, -32);
      ctx.globalAlpha = 0.6;
      ellipse(ctx, 25, 27, 8, 4, '#ffffff');
      ellipse(ctx, 39, 27, 8, 4, '#ffffff');
      ctx.globalAlpha = 1;
      ellipse(ctx, 32, 33, 6, 7, c.dark);
      ellipse(ctx, 32, 31, 5, 5.5, c.main);
      ellipse(ctx, 30, 29, 2, 1.5, c.light);
      ellipse(ctx, 30, 33, 1.6, 1.6, c.extra);
      ellipse(ctx, 34, 33, 1.6, 1.6, c.extra);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      break;
    }
    case 'turret': {
      lowPoly(ctx, 32, 48, 16, 7, 7, 4, c.light, c.main, c.dark);
      roundRect(ctx, 21, 18, 22, 30, 4, c.dark);
      roundRect(ctx, 21, 18, 13, 30, 4, c.main);
      roundRect(ctx, 18, 12, 28, 10, 3, c.light);
      roundRect(ctx, 18, 16, 28, 6, 2, c.main);
      ctx.shadowColor = c.extra;
      ctx.shadowBlur = 6;
      ellipse(ctx, 27, 30, 3, 3, c.extra);
      ellipse(ctx, 37, 30, 3, 3, c.extra);
      ctx.shadowBlur = 0;
      roundRect(ctx, 26, 37, 12, 3, 1, mix(c.dark, '#000000', 0.4));
      break;
    }
    case 'bomber': {
      ellipse(ctx, 32, 40, 15, 12, mix(c.main, '#000000', 0.4));
      ellipse(ctx, 32, 38, 14, 11, c.main);
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(32, 28);
      ctx.lineTo(32, 49);
      ctx.stroke();
      ellipse(ctx, 27, 34, 4, 3, c.light);
      ellipse(ctx, 32, 28, 7, 5, c.dark);
      ctx.strokeStyle = '#d8c8a8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(32, 24);
      ctx.quadraticCurveTo(36, 16, 40, 14);
      ctx.stroke();
      ctx.shadowColor = c.extra;
      ctx.shadowBlur = 8;
      ellipse(ctx, 40, 13, 3, 3, c.extra);
      ctx.shadowBlur = 0;
      ellipse(ctx, 29, 28, 1.6, 1.6, '#ffffff');
      ellipse(ctx, 35, 28, 1.6, 1.6, '#ffffff');
      break;
    }
    case 'turtle': {
      for (const [x, y] of [[16, 44], [48, 44], [18, 32], [46, 32]]) ellipse(ctx, x, y, 5, 4, c.extra);
      ellipse(ctx, 32, 22, 7, 7, c.extra);
      eyes(ctx, 32, 21, 3.5, 2);
      ellipse(ctx, 32, 41, 19, 13, c.dark);
      ellipse(ctx, 32, 38, 18, 13, c.main);
      for (const [x, y] of [[32, 36], [22, 39], [42, 39], [27, 45], [37, 45], [27, 30], [37, 30]]) {
        lowPoly(ctx, x, y, 5, 4, 6, 0, c.light, c.main, c.dark);
      }
      break;
    }
    case 'healer': {
      ctx.strokeStyle = '#6a4428';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(46, 50);
      ctx.lineTo(46, 18);
      ctx.stroke();
      ctx.shadowColor = '#7fff9f';
      ctx.shadowBlur = 10;
      ellipse(ctx, 46, 16, 4.5, 4.5, '#9fffb0');
      ctx.shadowBlur = 0;
      roundRect(ctx, 24, 32, 16, 18, 6, c.extra);
      roundRect(ctx, 24, 32, 8, 18, 5, mix(c.extra, '#ffffff', 0.3));
      ellipse(ctx, 32, 30, 17, 11, c.dark);
      ellipse(ctx, 32, 28, 16, 10, c.main);
      for (const [x, y] of [[25, 26], [36, 23], [40, 30], [30, 33]]) ellipse(ctx, x, y, 2.5, 2, '#ffffff');
      eyes(ctx, 32, 40, 3.5, 2);
      break;
    }
    case 'sniper': {
      ctx.strokeStyle = '#6a4428';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(46, 32, 13, -1.3, 1.3);
      ctx.stroke();
      ellipse(ctx, 32, 42, 12, 9, c.dark);
      ellipse(ctx, 32, 40, 11, 8, c.main);
      poly(ctx, [[20, 34], [32, 12], [44, 34]], c.dark);
      poly(ctx, [[20, 34], [32, 12], [32, 34]], c.main);
      ellipse(ctx, 32, 31, 7, 5, '#1a1020');
      ellipse(ctx, 29, 31, 1.8, 1.4, c.extra);
      ellipse(ctx, 35, 31, 1.8, 1.4, c.extra);
      break;
    }
    case 'mole': {
      for (const s of [-1, 1]) {
        ellipse(ctx, 32 + s * 15, 40, 6, 5, c.light);
        for (let i = -1; i <= 1; i++) ellipse(ctx, 32 + s * 17 + i * 3, 36, 1.4, 2.5, '#fff6e0');
      }
      ellipse(ctx, 32, 40, 15, 13, c.dark);
      ellipse(ctx, 32, 37, 14, 12, c.main);
      ellipse(ctx, 28, 32, 6, 4, mix(c.main, '#ffffff', 0.25));
      ellipse(ctx, 32, 33, 4.5, 3.5, c.extra);
      ellipse(ctx, 27, 29, 1.5, 1.2, '#1a1020');
      ellipse(ctx, 37, 29, 1.5, 1.2, '#1a1020');
      break;
    }
  }
}

// --- Текстуры биома ---------------------------------------------------------------

export function biomeKey(biome: Biome, name: string): string {
  return `${biome.id}-${name}`;
}

export function createBiomeTextures(scene: Phaser.Scene, biome: Biome, biomeIndex: number): void {
  const b = biome;

  make(scene, biomeKey(b, 'ground'), 256, 256, (ctx) => {
    ctx.fillStyle = b.ground;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 6 + Math.random() * 26;
      const color = Math.random() < 0.5 ? b.groundLight : b.groundDark;
      ctx.globalAlpha = 0.18 + Math.random() * 0.18;
      for (const dx of [-256, 0, 256]) {
        for (const dy of [-256, 0, 256]) ellipse(ctx, x + dx, y + dy, r, r * 0.6, color);
      }
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? b.groundDark : b.groundLight;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    ctx.globalAlpha = 1;
  });

  for (let i = 0; i < 3; i++) {
    make(scene, biomeKey(b, `rock${i}`), 80, 70, (ctx) => {
      lowPoly(ctx, 40, 36, 32 - i * 3, 22 - i * 2, 7 + i, 12, b.rockLight, b.rock, b.rockDark);
      if (b.treeShape === 'pine') lowPoly(ctx, 36, 28, 16, 8, 6, 0, '#ffffff', '#eef4ff', '#c8d8ee');
    });
  }

  make(scene, biomeKey(b, 'cliff'), 150, 160, (ctx) => {
    lowPoly(ctx, 75, 70, 66, 58, 9, 30, b.cliffLight, b.cliff, b.cliffDark);
    if (b.treeShape === 'pine') lowPoly(ctx, 66, 52, 32, 18, 7, 0, '#ffffff', '#eef4ff', '#c8d8ee');
    if (b.treeShape === 'bush' || b.treeShape === 'palm') {
      lowPoly(ctx, 60, 46, 26, 14, 7, 4, b.foliageLight, b.foliage, b.foliageDark);
    }
  });

  make(scene, biomeKey(b, 'tree'), 110, 140, (ctx) => drawTree(ctx, b));

  make(scene, biomeKey(b, 'pool'), 170, 100, (ctx) => {
    ellipse(ctx, 85, 54, 82, 44, mix(b.pool, '#000000', 0.25));
    ellipse(ctx, 85, 50, 80, 42, b.pool);
    ctx.strokeStyle = b.poolLight;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(85, 50, 70, 34, 0, Math.PI * 1.05, Math.PI * 1.6);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(95, 58, 34, 14, 0, Math.PI * 0.1, Math.PI * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  for (let i = 0; i < 3; i++) {
    make(scene, biomeKey(b, `decal${i}`), 28, 24, (ctx) => drawDecal(ctx, b, i));
  }

  make(scene, biomeKey(b, 'boss'), 192, 192, (ctx) => {
    const kinds: EnemyKind[] = ['crab', 'spitter', 'charger', 'shooter', 'blob'];
    const kind = kinds[biomeIndex % kinds.length];
    ctx.scale(3, 3);
    drawEnemy(ctx, kind, {
      main: b.boss.color,
      dark: b.boss.colorDark,
      light: mix(b.boss.color, '#ffffff', 0.45),
      extra: kind === 'spitter' ? b.foliage : kind === 'blob' ? '#2a0a0a' : b.accent,
    });
    // Корона — чтобы босса нельзя было спутать с обычным врагом. Сидит прямо на макушке.
    const crownTop: Partial<Record<EnemyKind, number>> = { crab: 14, spitter: 8, charger: 8, shooter: 10, blob: 20 };
    const top = crownTop[kind] ?? 8;
    ctx.translate(0, top - 8);
    poly(ctx, [[24, 8], [26, 2], [29, 6], [32, 0], [35, 6], [38, 2], [40, 8]], '#ffd23f');
    poly(ctx, [[24, 8], [40, 8], [40, 10], [24, 10]], '#d8a21f');
  });
}

function drawTree(ctx: Ctx, b: Biome): void {
  const L = b.foliageLight;
  const M = b.foliage;
  const D = b.foliageDark;
  switch (b.treeShape) {
    case 'palm': {
      ctx.strokeStyle = b.trunk;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(55, 132);
      ctx.quadraticCurveTo(48, 90, 60, 50);
      ctx.stroke();
      ctx.strokeStyle = mix(b.trunk, '#ffffff', 0.25);
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const ex = 60 + Math.cos(a) * 46;
        const ey = 48 + Math.sin(a) * 26;
        poly(ctx, [[60, 46], [ex, ey], [(60 + ex) / 2 + Math.sin(a) * 8, (46 + ey) / 2 - 8]], i % 2 ? M : L);
        poly(ctx, [[60, 50], [ex, ey], [(60 + ex) / 2 - Math.sin(a) * 6, (50 + ey) / 2 + 6]], D);
      }
      ellipse(ctx, 58, 50, 6, 5, '#7a5a2a');
      break;
    }
    case 'bush': {
      ctx.fillStyle = b.trunk;
      ctx.fillRect(49, 80, 12, 54);
      lowPoly(ctx, 55, 74, 40, 30, 8, 10, L, M, D);
      lowPoly(ctx, 38, 56, 26, 20, 7, 6, L, M, D);
      lowPoly(ctx, 70, 50, 28, 22, 7, 6, L, M, D);
      for (let i = 0; i < 4; i++) ellipse(ctx, 30 + i * 16, 60 + (i % 2) * 18, 3, 3, b.accent);
      break;
    }
    case 'pine': {
      ctx.fillStyle = b.trunk;
      ctx.fillRect(50, 110, 10, 26);
      for (let i = 0; i < 4; i++) {
        const y = 112 - i * 26;
        const w = 46 - i * 9;
        poly(ctx, [[55 - w, y], [55, y - 40], [55 + w, y]], D);
        poly(ctx, [[55 - w, y], [55, y - 40], [55, y - 4]], M);
        poly(ctx, [[55 - w * 0.4, y - 26], [55, y - 40], [55 + w * 0.4, y - 26]], '#ffffff');
      }
      break;
    }
    case 'cactus': {
      roundRect(ctx, 44, 30, 22, 106, 11, D);
      roundRect(ctx, 44, 30, 13, 106, 9, M);
      roundRect(ctx, 20, 60, 14, 40, 7, D);
      roundRect(ctx, 20, 92, 30, 12, 6, D);
      roundRect(ctx, 76, 46, 14, 40, 7, D);
      roundRect(ctx, 60, 78, 30, 12, 6, D);
      roundRect(ctx, 21, 60, 7, 40, 4, L);
      roundRect(ctx, 77, 46, 7, 40, 4, L);
      ellipse(ctx, 55, 30, 6, 4, b.accent);
      break;
    }
    case 'spire': {
      poly(ctx, [[30, 136], [52, 10], [82, 136]], b.rockDark);
      poly(ctx, [[30, 136], [52, 10], [58, 136]], b.rock);
      ctx.strokeStyle = L;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = M;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(52, 30);
      ctx.lineTo(58, 60);
      ctx.lineTo(50, 86);
      ctx.lineTo(62, 120);
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }
  }
}

function drawDecal(ctx: Ctx, b: Biome, variant: number): void {
  if (variant === 0) {
    ctx.strokeStyle = b.treeShape === 'spire' ? b.foliage : b.foliageDark;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(14, 22);
      ctx.lineTo(4 + i * 5, 6 + Math.abs(i - 2) * 4);
      ctx.stroke();
    }
  } else if (variant === 1) {
    lowPoly(ctx, 10, 16, 7, 5, 5, 3, b.rockLight, b.rock, b.rockDark);
    lowPoly(ctx, 20, 18, 5, 3.5, 5, 2, b.rockLight, b.rock, b.rockDark);
  } else {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ellipse(ctx, 14 + Math.cos(a) * 4, 12 + Math.sin(a) * 4, 3.5, 3.5, b.accent);
    }
    ellipse(ctx, 14, 12, 2.5, 2.5, '#fff6c0');
  }
}
