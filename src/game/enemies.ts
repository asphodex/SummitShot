import Phaser from 'phaser';
import { BOSS_PHASE2_AT } from './constants';
import type { Temperature } from './daycycle';
import type { BossPattern, EnemyKind } from './season';

/** Класс врага — в каждом уровне стараемся смешать разные классы. */
export type EnemyClass = 'melee' | 'ranged' | 'flyer' | 'tank' | 'special';
export const ENEMY_CLASSES: EnemyClass[] = ['melee', 'ranged', 'flyer', 'tank', 'special'];

export interface EnemyDef {
  cls: EnemyClass;
  /**
   * Общий враг встречается в любом биоме, начиная с уровня unlock.
   * Остальные — биомные: живут только в своём биоме (см. Biome.enemies в season.ts).
   */
  common: boolean;
  unlock: number;
  /** Сколько штук появляется вместе (стая). */
  pack: number;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  xp: number;
  flying: boolean;
  /** Тёплые слабеют на закате и ночью, ледяные — крепнут (см. daycycle.ts). */
  temp: Temperature;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  // Биомные.
  crab: { cls: 'melee', common: false, unlock: 1, pack: 1, hp: 22, speed: 125, radius: 15, damage: 12, xp: 4, flying: false, temp: 'warm' },
  spitter: { cls: 'ranged', common: false, unlock: 1, pack: 1, hp: 30, speed: 0, radius: 16, damage: 12, xp: 5, flying: false, temp: 'warm' },
  bat: { cls: 'flyer', common: false, unlock: 1, pack: 1, hp: 14, speed: 150, radius: 13, damage: 10, xp: 4, flying: true, temp: 'neutral' },
  turtle: { cls: 'tank', common: false, unlock: 1, pack: 1, hp: 70, speed: 55, radius: 19, damage: 16, xp: 9, flying: false, temp: 'warm' },
  charger: { cls: 'tank', common: false, unlock: 1, pack: 1, hp: 48, speed: 75, radius: 19, damage: 22, xp: 7, flying: false, temp: 'cold' },
  mole: { cls: 'special', common: false, unlock: 1, pack: 1, hp: 34, speed: 140, radius: 15, damage: 16, xp: 7, flying: false, temp: 'cold' },
  shooter: { cls: 'ranged', common: false, unlock: 1, pack: 1, hp: 32, speed: 95, radius: 15, damage: 12, xp: 6, flying: false, temp: 'warm' },
  bomber: { cls: 'special', common: false, unlock: 1, pack: 2, hp: 16, speed: 150, radius: 13, damage: 0, xp: 5, flying: false, temp: 'warm' },
  blob: { cls: 'tank', common: false, unlock: 1, pack: 1, hp: 36, speed: 90, radius: 17, damage: 14, xp: 6, flying: false, temp: 'warm' },
  turret: { cls: 'ranged', common: false, unlock: 1, pack: 1, hp: 40, speed: 0, radius: 16, damage: 10, xp: 6, flying: false, temp: 'neutral' },
  // Учебная мишень: стоит на месте и не кусается. Ни в один микс не попадает.
  dummy: { cls: 'special', common: false, unlock: 99, pack: 1, hp: 20, speed: 0, radius: 18, damage: 0, xp: 2, flying: false, temp: 'neutral' },
  // Общие — открываются по ходу сезона и встречаются везде.
  gnat: { cls: 'flyer', common: true, unlock: 2, pack: 4, hp: 7, speed: 175, radius: 9, damage: 6, xp: 1, flying: true, temp: 'warm' },
  healer: { cls: 'special', common: true, unlock: 9, pack: 1, hp: 26, speed: 85, radius: 14, damage: 8, xp: 8, flying: false, temp: 'neutral' },
  sniper: { cls: 'ranged', common: true, unlock: 12, pack: 1, hp: 24, speed: 80, radius: 14, damage: 10, xp: 7, flying: false, temp: 'neutral' },
};

export const ALL_ENEMY_KINDS = Object.keys(ENEMY_DEFS) as EnemyKind[];

/** Крот под землёй — в него нельзя попасть и он не кусает. */
export function isHidden(e: Enemy): boolean {
  return e.kind === 'mole' && e.state === 'under';
}

/** Черепаха в панцире — стрелы отскакивают. */
export function isShielded(e: Enemy): boolean {
  return e.kind === 'turtle' && e.state === 'shell';
}

/** Начальное состояние для врагов со своим циклом поведения. */
export function initialState(kind: EnemyKind): string {
  if (kind === 'mole') return 'under';
  if (kind === 'turtle' || kind === 'sniper') return 'walk';
  return 'idle';
}

export interface BossState {
  name: string;
  patterns: BossPattern[];
  pattern: BossPattern | null;
  lastPattern: BossPattern | null;
  cooldown: number;
  step: number;
  stepTimer: number;
  spin: number;
  phase2: boolean;
  minion: EnemyKind;
}

export interface Enemy {
  kind: EnemyKind | 'boss';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Отбрасывание от попаданий — складывается со скоростью ИИ. */
  kx: number;
  ky: number;
  radius: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  xp: number;
  flying: boolean;
  small: boolean;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  baseScale: number;
  awake: boolean;
  dead: boolean;
  state: string;
  timer: number;
  aim: number;
  alt: boolean;
  bumped: boolean;
  hop: number;
  flash: number;
  squash: number;
  wobble: number;
  slow: number;
  poison: number;
  poisonTick: number;
  boss: BossState | null;
}

/** То, что ИИ может спросить у мира или попросить сделать. */
export interface EnemyWorld {
  playerX: number;
  playerY: number;
  minX: number;
  maxX: number;
  arenaTop: number;
  arenaBottom: number;
  fireShot(x: number, y: number, angle: number, speed: number, high: boolean): void;
  spawnMinion(kind: EnemyKind, x: number, y: number): void;
  spawnBlast(x: number, y: number, radius: number, delay: number): void;
  countMinions(): number;
  /** Подрыв жука-бомбы: взрыв на месте и смерть. */
  detonate(e: Enemy): void;
  /** Лечение врагов вокруг шамана. */
  healAround(e: Enemy, radius: number, fraction: number): void;
  shake(intensity: number, ms: number): void;
  roar(): void;
}

function angleTo(e: Enemy, w: EnemyWorld): number {
  return Math.atan2(w.playerY - e.y, w.playerX - e.x);
}

function distTo(e: Enemy, w: EnemyWorld): number {
  return Math.hypot(w.playerX - e.x, w.playerY - e.y);
}

function moveAt(e: Enemy, angle: number, speed: number): void {
  e.vx = Math.cos(angle) * speed;
  e.vy = Math.sin(angle) * speed;
}

/** Один шаг "мысли" врага: меняет скорость, состояние и стреляет. */
export function thinkEnemy(e: Enemy, w: EnemyWorld, dt: number): void {
  e.wobble += dt;
  e.timer -= dt;
  switch (e.kind) {
    case 'crab': return thinkCrab(e, w);
    case 'spitter': return thinkSpitter(e, w);
    case 'bat': return thinkBat(e, w);
    case 'charger': return thinkCharger(e, w);
    case 'shooter': return thinkShooter(e, w);
    case 'blob': return thinkBlob(e, w);
    case 'gnat': return thinkGnat(e, w);
    case 'turret': return thinkTurret(e, w);
    case 'bomber': return thinkBomber(e, w);
    case 'turtle': return thinkTurtle(e, w);
    case 'healer': return thinkHealer(e, w);
    case 'sniper': return thinkSniper(e, w);
    case 'mole': return thinkMole(e, w);
    case 'dummy': return thinkDummy(e);
    case 'boss': return thinkBoss(e, w, dt);
  }
}

/** Мишень стоит на месте; стреляет за неё сам сценарий обучения. */
function thinkDummy(e: Enemy): void {
  e.vx = 0;
  e.vy = 0;
}

/** Держаться на дистанции и обходить игрока по кругу. */
function keepDistance(e: Enemy, w: EnemyWorld, near: number, far: number): void {
  const a = angleTo(e, w);
  const d = distTo(e, w);
  if (d < near) moveAt(e, a + Math.PI, e.speed);
  else if (d > far) moveAt(e, a, e.speed);
  else moveAt(e, a + (e.alt ? Math.PI / 2 : -Math.PI / 2), e.speed * 0.6);
  if (Math.random() < 0.01) e.alt = !e.alt;
}

/** Мошкара: быстрая стая, летит рывками. */
function thinkGnat(e: Enemy, w: EnemyWorld): void {
  moveAt(e, angleTo(e, w) + Math.sin(e.wobble * 7 + e.aim) * 1.1, e.speed);
}

/** Тотем: стоит и стреляет крестом, чередуя + и x. */
function thinkTurret(e: Enemy, w: EnemyWorld): void {
  e.vx = 0;
  e.vy = 0;
  if (e.timer < 0.4 && e.state !== 'windup') {
    e.state = 'windup';
    e.squash = -0.2;
  }
  if (e.timer > 0) return;
  e.state = 'idle';
  e.timer = 2.1 + Math.random() * 0.4;
  if (distTo(e, w) > 520) return;
  e.alt = !e.alt;
  const base = e.alt ? Math.PI / 4 : 0;
  for (let i = 0; i < 4; i++) w.fireShot(e.x, e.y - 12, base + (i * Math.PI) / 2, 190, false);
  e.squash = 0.3;
}

/** Жук-бомба: бежит к игроку, шипит и взрывается. */
function thinkBomber(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'windup') {
    e.vx *= 0.8;
    e.vy *= 0.8;
    e.squash = Math.sin(e.wobble * 40) * 0.15;
    if (e.timer <= 0) w.detonate(e);
    return;
  }
  moveAt(e, angleTo(e, w) + Math.sin(e.wobble * 10) * 0.3, e.speed);
  if (distTo(e, w) < 70) {
    e.state = 'windup';
    e.timer = 0.7;
  }
}

/** Черепаха: идёт, потом прячется в неуязвимый панцирь. */
function thinkTurtle(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'shell') {
    e.vx = 0;
    e.vy = 0;
    if (e.timer <= 0) {
      e.state = 'walk';
      e.timer = 2.2 + Math.random();
      e.squash = 0.3;
    }
    return;
  }
  moveAt(e, angleTo(e, w), e.speed);
  if (e.timer <= 0) {
    e.state = 'shell';
    e.timer = 1.6;
    e.squash = -0.3;
  }
}

/** Шаман: держится сзади и лечит союзников. */
function thinkHealer(e: Enemy, w: EnemyWorld): void {
  keepDistance(e, w, 240, 340);
  if (e.timer < 0.45 && e.state !== 'windup') {
    e.state = 'windup';
    e.squash = -0.2;
  }
  if (e.timer > 0) return;
  e.state = 'idle';
  e.timer = 3 + Math.random() * 0.5;
  w.healAround(e, 180, 0.3);
  e.squash = 0.3;
}

/** Снайпер: целится лазером, потом стреляет очень быстрой стрелой. */
function thinkSniper(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'aim') {
    e.vx = 0;
    e.vy = 0;
    // Прицел следит за игроком, а последние 0.35 с замирает — время увернуться.
    if (e.timer > 0.35) e.aim = angleTo(e, w);
    if (e.timer > 0) return;
    w.fireShot(e.x, e.y - 10, e.aim, 560, false);
    e.squash = 0.3;
    e.state = 'walk';
    e.timer = 2.2 + Math.random();
    return;
  }
  keepDistance(e, w, 280, 420);
  if (e.timer <= 0 && distTo(e, w) < 560) {
    e.state = 'aim';
    e.timer = 1.1;
    e.aim = angleTo(e, w);
  }
}

/** Крот: роет под землёй и выпрыгивает прямо под ногами. */
function thinkMole(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'under') {
    moveAt(e, angleTo(e, w) + Math.sin(e.wobble * 3) * 0.4, e.speed);
    if (distTo(e, w) < 34 || e.timer <= 0) {
      e.state = 'up';
      e.timer = 1.6;
      e.squash = 0.5;
      e.vx = 0;
      e.vy = 0;
      w.shake(0.004, 100);
    }
    return;
  }
  e.vx = 0;
  e.vy = 0;
  if (e.timer <= 0) {
    e.state = 'under';
    e.timer = 3.5 + Math.random();
  }
}

function thinkCrab(e: Enemy, w: EnemyWorld): void {
  const a = angleTo(e, w);
  const side = Math.sin(e.wobble * 9) * 0.5;
  moveAt(e, a + side, e.speed);
}

function thinkSpitter(e: Enemy, w: EnemyWorld): void {
  e.vx = 0;
  e.vy = 0;
  if (e.timer < 0.35 && e.state !== 'windup') {
    e.state = 'windup';
    e.squash = -0.25;
  }
  if (e.timer > 0) return;
  e.state = 'idle';
  e.timer = 1.7 + Math.random() * 0.6;
  if (distTo(e, w) > 470) return;
  e.alt = !e.alt;
  e.squash = 0.3;
  w.fireShot(e.x, e.y - 10, angleTo(e, w), e.alt ? 210 : 250, e.alt);
}

function thinkBat(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'dive') {
    if (e.timer <= 0) {
      e.state = 'fly';
      e.timer = 1.8 + Math.random();
    }
    return;
  }
  const a = angleTo(e, w);
  moveAt(e, a + Math.sin(e.wobble * 4) * 0.9, e.speed);
  if (e.timer <= 0 && distTo(e, w) < 330) {
    e.state = 'dive';
    e.timer = 0.42;
    e.squash = 0.3;
    moveAt(e, a, e.speed * 3.2);
  }
}

function thinkCharger(e: Enemy, w: EnemyWorld): void {
  switch (e.state) {
    case 'windup':
      e.vx = 0;
      e.vy = 0;
      e.squash = Math.sin(e.wobble * 50) * 0.08;
      if (e.timer <= 0) {
        e.state = 'charge';
        e.timer = 0.6;
        moveAt(e, e.aim, 560);
      }
      return;
    case 'charge':
      if (e.bumped) {
        e.state = 'rest';
        e.timer = 1.3;
        e.squash = 0.4;
        w.shake(0.006, 120);
      } else if (e.timer <= 0) {
        e.state = 'rest';
        e.timer = 0.7;
      }
      return;
    case 'rest':
      e.vx *= 0.85;
      e.vy *= 0.85;
      if (e.timer <= 0) {
        e.state = 'walk';
        e.timer = 1;
      }
      return;
    default:
      moveAt(e, angleTo(e, w), e.speed);
      if (e.timer <= 0 && distTo(e, w) < 330) {
        e.state = 'windup';
        e.timer = 0.6;
        e.aim = angleTo(e, w);
      }
  }
}

function thinkShooter(e: Enemy, w: EnemyWorld): void {
  const a = angleTo(e, w);
  const d = distTo(e, w);
  keepDistance(e, w, 220, 330);

  if (e.timer < 0.3 && e.state !== 'windup') {
    e.state = 'windup';
    e.squash = -0.2;
  }
  if (e.timer > 0) return;
  e.state = 'idle';
  e.timer = 2 + Math.random() * 0.6;
  if (d > 560) return;
  for (const off of [-0.22, 0, 0.22]) w.fireShot(e.x, e.y - 8, a + off, 240, false);
  e.squash = 0.25;
}

function thinkBlob(e: Enemy, w: EnemyWorld): void {
  if (e.state === 'hop') {
    const t = 1 - e.timer / 0.45;
    e.hop = Math.sin(Phaser.Math.Clamp(t, 0, 1) * Math.PI) * (e.small ? 12 : 20);
    if (e.timer <= 0) {
      e.state = 'idle';
      e.timer = 0.45 + Math.random() * 0.4;
      e.hop = 0;
      e.squash = 0.35;
      e.vx = 0;
      e.vy = 0;
    }
    return;
  }
  e.vx *= 0.8;
  e.vy *= 0.8;
  if (e.timer <= 0) {
    e.state = 'hop';
    e.timer = 0.45;
    e.squash = -0.3;
    moveAt(e, angleTo(e, w) + (Math.random() - 0.5) * 0.5, e.speed * (e.small ? 3.2 : 2.6));
  }
}

// --- Босс ---------------------------------------------------------------------------

function pickPattern(b: BossState): BossPattern {
  const options = b.patterns.filter((p) => p !== b.lastPattern);
  return options[Math.floor(Math.random() * options.length)] ?? b.patterns[0];
}

function thinkBoss(e: Enemy, w: EnemyWorld, dt: number): void {
  const b = e.boss;
  if (!b) return;

  if (!b.phase2 && e.hp < e.maxHp * BOSS_PHASE2_AT) {
    b.phase2 = true;
    e.flash = 0.4;
    w.roar();
    w.shake(0.02, 500);
  }

  if (b.pattern !== 'charge') hover(e, w);

  if (!b.pattern) {
    b.cooldown -= dt;
    if (b.cooldown > 0) return;
    b.pattern = pickPattern(b);
    b.lastPattern = b.pattern;
    b.step = 0;
    b.stepTimer = b.pattern === 'charge' ? 0.7 : 0.3;
    if (b.pattern === 'charge') e.state = 'windup';
    e.squash = -0.15;
    return;
  }

  // Таран заканчивается раньше, если босс врезался в стену арены.
  if (b.pattern === 'charge' && e.state === 'charge' && e.bumped) b.stepTimer = 0;

  b.stepTimer -= dt;
  if (b.stepTimer > 0) {
    if (b.pattern === 'charge' && e.state === 'windup') {
      e.squash = Math.sin(e.wobble * 50) * 0.06;
    }
    return;
  }
  runPatternStep(e, b, w);
}

function hover(e: Enemy, w: EnemyWorld): void {
  const targetX = Phaser.Math.Clamp(w.playerX, w.minX + 90, w.maxX - 90);
  const targetY = w.arenaTop + 300 + Math.sin(e.wobble * 1.3) * 26;
  e.vx = Phaser.Math.Clamp((targetX - e.x) * 1.2, -e.speed, e.speed);
  e.vy = Phaser.Math.Clamp((targetY - e.y) * 1.2, -e.speed, e.speed);
}

function endPattern(b: BossState): void {
  b.pattern = null;
  b.cooldown = b.phase2 ? 0.75 : 1.25;
}

function runPatternStep(e: Enemy, b: BossState, w: EnemyWorld): void {
  const p2 = b.phase2;
  const aim = angleTo(e, w);
  b.step += 1;

  switch (b.pattern) {
    case 'burst': {
      const n = p2 ? 22 : 16;
      const off = b.step % 2 ? 0 : Math.PI / n;
      for (let i = 0; i < n; i++) w.fireShot(e.x, e.y, off + (i / n) * Math.PI * 2, 175, false);
      e.squash = 0.3;
      w.shake(0.006, 120);
      b.stepTimer = 0.5;
      if (b.step >= (p2 ? 3 : 2)) endPattern(b);
      return;
    }
    case 'fan': {
      for (let i = -2; i <= 2; i++) w.fireShot(e.x, e.y, aim + i * 0.17, 270, false);
      e.squash = 0.2;
      b.stepTimer = 0.33;
      if (b.step >= (p2 ? 4 : 3)) endPattern(b);
      return;
    }
    case 'spiral': {
      const arms = p2 ? 3 : 2;
      b.spin += 0.33;
      for (let i = 0; i < arms; i++) w.fireShot(e.x, e.y, b.spin + (i / arms) * Math.PI * 2, 170, false);
      b.stepTimer = 0.085;
      if (b.step >= 28) endPattern(b);
      return;
    }
    case 'sweep': {
      // Стена высоких снарядов — от неё спасает только присед или перекат.
      for (let x = w.minX + 10; x <= w.maxX - 10; x += 38) {
        w.fireShot(x, e.y + 40, Math.PI / 2, 210, true);
      }
      e.squash = 0.35;
      w.shake(0.008, 150);
      b.stepTimer = 0.9;
      if (b.step >= (p2 ? 2 : 1)) endPattern(b);
      return;
    }
    case 'meteor': {
      const n = p2 ? 6 : 4;
      w.spawnBlast(w.playerX, w.playerY, 62, 1.1);
      for (let i = 1; i < n; i++) {
        w.spawnBlast(
          Phaser.Math.Clamp(w.playerX + (Math.random() - 0.5) * 360, w.minX + 40, w.maxX - 40),
          Phaser.Math.Clamp(w.playerY + (Math.random() - 0.5) * 260, w.arenaTop + 240, w.arenaBottom - 40),
          62,
          1.1 + i * 0.12,
        );
      }
      e.squash = 0.3;
      b.stepTimer = 1.4;
      endPattern(b);
      return;
    }
    case 'summon': {
      if (w.countMinions() < 6) {
        const n = p2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random();
          w.spawnMinion(b.minion, e.x + Math.cos(a) * 80, e.y + 40 + Math.sin(a) * 50);
        }
      }
      e.squash = 0.3;
      endPattern(b);
      return;
    }
    case 'charge': {
      runCharge(e, b, w);
      return;
    }
    default:
      endPattern(b);
  }
}

function runCharge(e: Enemy, b: BossState, w: EnemyWorld): void {
  const charges = b.phase2 ? 3 : 2;
  if (e.state !== 'charge') {
    e.state = 'charge';
    moveAt(e, angleTo(e, w), b.phase2 ? 600 : 520);
    b.stepTimer = 0.9;
    return;
  }
  e.state = 'windup';
  e.vx = 0;
  e.vy = 0;
  w.shake(0.012, 180);
  if (b.step >= charges * 2) {
    e.state = 'idle';
    endPattern(b);
    return;
  }
  b.stepTimer = 0.55;
}
