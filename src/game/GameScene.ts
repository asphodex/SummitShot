import Phaser from 'phaser';
import * as C from './constants';
import { showChoice } from './choice';
import { ENEMY_DEFS, thinkEnemy, type Enemy, type EnemyWorld } from './enemies';
import { Hud } from './hud';
import { BEAM_HALF_THICKNESS, generateLayout, type Arena, type Layout } from './level';
import { getSeason, planLevel, type EnemyKind, type LevelPlan } from './season';
import { sfx } from './sfx';
import { biomeKey, createBiomeTextures, createCommonTextures, toColor } from './textures';
import {
  ABILITIES,
  UPGRADES,
  clearRun,
  newRun,
  rollChoices,
  saveRun,
  type AbilityId,
  type RunState,
} from './upgrades';

type Mode = 'play' | 'choice' | 'exit' | 'dead' | 'end';
type KeyName = 'up' | 'down' | 'left' | 'right' | 'up2' | 'down2' | 'left2' | 'right2' | 'fire' | 'roll' | 'crouch' | 'crouch2';
type Img = Phaser.GameObjects.Image;

interface Obstacle { x: number; y: number; r: number }
interface Beam { x1: number; x2: number; y: number }
interface Pool { x: number; y: number; rx: number; ry: number }

interface Arrow {
  x: number; y: number; vx: number; vy: number;
  life: number; damage: number; pierce: number; bounces: number;
  hits: Enemy[]; stuck: number; sprite: Img; shadow: Img;
}

interface Shot {
  x: number; y: number; vx: number; vy: number;
  high: boolean; damage: number; life: number; sprite: Img; shadow: Img;
}

interface Orb {
  x: number; y: number; vx: number; vy: number; z: number; vz: number;
  value: number; age: number; sprite: Img; shadow: Img;
}

interface Blast { x: number; y: number; r: number; timer: number; delay: number; ring: Img; fill: Img }

interface Player {
  x: number; y: number; vx: number; vy: number;
  stamina: number; staminaDelay: number; invuln: number;
  fireCooldown: number; volley: number;
  burstLeft: number; burstTimer: number; burstAngle: number;
  crouch: boolean; crouchK: number;
  roll: number; rollDx: number; rollDy: number; rollHits: Set<Enemy>;
  aim: number; squash: number; walk: number; dustTimer: number;
  sprite: Img; shadow: Img; bow: Img;
}

const ENEMY_TINT: Record<EnemyKind | 'boss', number> = {
  crab: 0xff6f4f, spitter: 0xb04fd0, bat: 0x5a3a7a, charger: 0xf0ece2, shooter: 0x3a3248, blob: 0xff7a2f, boss: 0xffd23f,
};

/** Высота, на которой летят стрелы над землёй. */
const ARROW_HEIGHT = 14;
const ORB_GRAVITY = 700;
const SHOT_LIFETIME = 6;
const EXIT_DURATION = 1.4;

/**
 * Главная сцена: один уровень восхождения. Каждый новый уровень — рестарт сцены
 * с тем же RunState (опыт, усиления и здоровье переносятся).
 */
export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private plan!: LevelPlan;
  private layout!: Layout;
  private arena: Arena | null = null;
  private mode: Mode = 'play';

  private player!: Player;
  private obstacles: Obstacle[] = [];
  private beams: Beam[] = [];
  private pools: Pool[] = [];
  private enemies: Enemy[] = [];
  private arrows: Arrow[] = [];
  private shots: Shot[] = [];
  private orbs: Orb[] = [];
  private blasts: Blast[] = [];

  private boss: Enemy | null = null;
  private arenaLocked = false;
  private gate: Phaser.GameObjects.TileSprite | null = null;
  private world!: EnemyWorld;

  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private hud!: Hud;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private chunks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hurtOverlay!: Img;

  private hitstop = 0;
  private hurtFlash = 0;
  private pickupStreak = 0;
  private pickupStreakTimer = 0;
  private pendingUpgrades = 0;
  private pendingAbility = false;
  private exitTimer = 0;
  private exitStarted = false;
  private lastShotSfx = 0;
  private levelTime = 0;

  constructor() {
    super('GameScene');
  }

  init(data: { run?: RunState }): void {
    this.run = data.run ?? newRun(0);
  }

  create(): void {
    this.resetState();
    const run = this.run;
    this.plan = planLevel(run.season, run.level, run.seed);
    this.layout = generateLayout(this.plan);
    this.arena = this.layout.arena;

    createCommonTextures(this);
    createBiomeTextures(this, this.plan.biome, this.plan.biomeIndex);
    if (run.xpNeeded <= 0) run.xpNeeded = this.computeXpNeeded();
    saveRun(run);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, C.GAME_WIDTH, this.plan.length);
    cam.setBackgroundColor(this.plan.biome.groundDark);

    this.buildWorld();
    this.createPlayer();
    this.createEffects();
    this.createWorldApi();
    this.setupInput();
    this.hud = new Hud(this, this.plan.biome.name, run.level);

    cam.scrollY = this.plan.length - C.GAME_HEIGHT;
    cam.fadeIn(450, 20, 10, 30);
    this.showBanner();
  }

  private resetState(): void {
    this.mode = 'play';
    this.obstacles = [];
    this.beams = [];
    this.pools = [];
    this.enemies = [];
    this.arrows = [];
    this.shots = [];
    this.orbs = [];
    this.blasts = [];
    this.boss = null;
    this.arenaLocked = false;
    this.gate = null;
    this.hitstop = 0;
    this.hurtFlash = 0;
    this.pickupStreak = 0;
    this.pendingUpgrades = 0;
    this.pendingAbility = false;
    this.exitTimer = 0;
    this.exitStarted = false;
    this.levelTime = 0;
  }

  /** Сколько опыта нужно до следующего усиления: ~1 усиление на LEVELS_PER_UPGRADE уровней. */
  private computeXpNeeded(): number {
    const kinds = this.plan.enemyKinds;
    const avgXp = kinds.reduce((sum, k) => sum + ENEMY_DEFS[k].xp, 0) / kinds.length;
    const perLevel = Math.max(30, (this.plan.isBoss ? 10 : this.plan.enemyCount) * avgXp);
    return Math.round(perLevel * C.LEVELS_PER_UPGRADE);
  }

  // ===========================================================================
  // Построение уровня
  // ===========================================================================

  private buildWorld(): void {
    const b = this.plan.biome;
    const L = this.plan.length;

    this.add.tileSprite(0, 0, C.GAME_WIDTH, L, biomeKey(b, 'ground')).setOrigin(0).setDepth(C.DEPTH.ground);

    for (const d of this.layout.decals) {
      this.add.image(d.x, d.y, biomeKey(b, `decal${d.variant}`)).setDepth(C.DEPTH.decal).setAlpha(0.85);
    }

    for (const p of this.layout.pools) {
      const img = this.add.image(p.x, p.y, biomeKey(b, 'pool')).setDepth(C.DEPTH.pool);
      img.setScale((p.rx * 2) / 160, (p.ry * 2) / 88);
      if (b.poolHurts) {
        this.tweens.add({ targets: img, alpha: 0.75, duration: 700 + Math.random() * 400, yoyo: true, repeat: -1 });
      }
      this.pools.push(p);
    }

    this.buildCliffs();

    for (const o of this.layout.obstacles) {
      const key = o.kind === 'tree' ? biomeKey(b, 'tree') : biomeKey(b, `rock${o.variant}`);
      const img = this.add.image(o.x, o.y, key).setScale(o.scale).setDepth(C.DEPTH.world + o.y);
      img.setOrigin(0.5, o.kind === 'tree' ? 0.94 : 0.6);
      this.add.image(o.x + 4, o.y + 3, 'shadow').setScale((o.r * 2.6) / 64).setDepth(C.DEPTH.shadow);
      if (o.kind === 'tree') {
        img.setAngle(-1.2);
        this.tweens.add({ targets: img, angle: 1.2, duration: 1600 + Math.random() * 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
      this.obstacles.push({ x: o.x, y: o.y, r: o.r });
    }

    for (const beam of this.layout.beams) this.buildBeam(beam);

    // Флаг на вершине — выход с уровня.
    const flag = this.add.image(C.GAME_WIDTH / 2, C.EXIT_Y, 'flag').setOrigin(0.5, 0.92).setDepth(C.DEPTH.world + C.EXIT_Y);
    this.tweens.add({ targets: flag, scaleX: 0.92, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.add.image(C.GAME_WIDTH / 2, C.EXIT_Y, 'shadow').setScale(1.4, 1).setDepth(C.DEPTH.shadow);
    this.add.image(C.GAME_WIDTH / 2, C.EXIT_Y - 30, 'soft').setScale(5).setAlpha(0.35).setDepth(C.DEPTH.decal);

    for (const s of this.layout.spawns) this.createEnemy(s.kind, s.x, s.y);

    if (this.arena) this.buildArena(this.arena);

    // Атмосфера: туман сверху, виньетка, красная вспышка урона.
    this.add.image(0, 0, 'fog').setOrigin(0).setDisplaySize(C.GAME_WIDTH, 170)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay).setTint(toColor(b.fog)).setAlpha(0.6);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(C.GAME_WIDTH, C.GAME_HEIGHT)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay + 1);
    this.hurtOverlay = this.add.image(0, 0, 'hurt').setOrigin(0).setDisplaySize(C.GAME_WIDTH, C.GAME_HEIGHT)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay + 2).setAlpha(0);
  }

  private buildCliffs(): void {
    const b = this.plan.biome;
    const L = this.plan.length;
    const dark = toColor(b.cliffDark);
    this.add.rectangle(0, 0, C.SIDE_WALL, L, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    this.add.rectangle(C.GAME_WIDTH - C.SIDE_WALL, 0, C.SIDE_WALL, L, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    const rng = this.plan.rng;
    for (let y = -40; y < L + 80; y += 62) {
      for (const side of [0, 1]) {
        const x = side === 0 ? rng.between(-20, 20) : C.GAME_WIDTH - rng.between(-20, 20);
        const yy = y + rng.between(-14, 14);
        this.add.image(x, yy, biomeKey(b, 'cliff'))
          .setOrigin(0.5, 0.7)
          .setScale(rng.realInRange(0.8, 1.1))
          .setFlipX(side === 1)
          .setDepth(C.DEPTH.world + yy + 40);
      }
    }
  }

  private buildBeam(beam: Beam): void {
    const width = beam.x2 - beam.x1;
    this.add.rectangle(beam.x1, beam.y + 4, width, 14, 0x000000, 0.18).setOrigin(0, 0.5).setDepth(C.DEPTH.shadow);
    for (const x of [beam.x1 + 8, beam.x2 - 8]) {
      this.add.image(x, beam.y + 12, 'post').setOrigin(0.5, 0.9).setDepth(C.DEPTH.world + beam.y + 10);
    }
    this.add.image(beam.x1, beam.y - 26, 'log').setOrigin(0, 0.5)
      .setDisplaySize(width, 30)
      .setDepth(C.DEPTH.world + beam.y + 30);
    this.beams.push(beam);
  }

  private buildArena(arena: Arena): void {
    this.gate = this.add.tileSprite(C.SIDE_WALL, arena.gateY, C.GAME_WIDTH - C.SIDE_WALL * 2, 76, 'stake')
      .setOrigin(0, 0.85)
      .setDepth(C.DEPTH.world + arena.gateY);
    this.boss = this.createBoss(arena);
  }

  // ===========================================================================
  // Создание сущностей
  // ===========================================================================

  private createPlayer(): void {
    const x = C.GAME_WIDTH / 2;
    const y = this.plan.length - 130;
    this.player = {
      x, y, vx: 0, vy: 0,
      stamina: this.run.maxStamina, staminaDelay: 0, invuln: 0,
      fireCooldown: 0, volley: 0, burstLeft: 0, burstTimer: 0, burstAngle: 0,
      crouch: false, crouchK: 0,
      roll: 0, rollDx: 0, rollDy: -1, rollHits: new Set(),
      aim: -Math.PI / 2, squash: 0, walk: 0, dustTimer: 0,
      shadow: this.add.image(x, y, 'shadow').setScale(0.55).setDepth(C.DEPTH.shadow),
      sprite: this.add.image(x, y, 'player').setOrigin(0.5, 0.9),
      bow: this.add.image(x, y, 'bow').setOrigin(0.25, 0.5),
    };
  }

  private createEnemy(kind: EnemyKind, x: number, y: number, small = false): Enemy {
    const def = ENEMY_DEFS[kind];
    const d = this.plan.difficulty;
    const baseScale = small ? 0.6 : 0.9;
    const hp = Math.round(def.hp * d * (small ? 0.4 : 1));
    const e: Enemy = {
      kind, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      radius: def.radius * (small ? 0.65 : 1),
      hp, maxHp: hp,
      damage: Math.round(def.damage * this.damageScale()),
      speed: def.speed * (0.9 + Math.random() * 0.2) * (1 + (d - 1) * 0.08),
      xp: small ? Math.ceil(def.xp / 2) : def.xp,
      flying: def.flying, small,
      sprite: this.add.image(x, y, kind).setOrigin(0.5, 0.72).setScale(baseScale),
      shadow: this.add.image(x, y, 'shadow').setDepth(C.DEPTH.shadow),
      baseScale, awake: false, dead: false,
      state: 'idle', timer: 0.4 + Math.random() * 1.2, aim: 0, alt: Math.random() < 0.5, bumped: false,
      hop: 0, flash: 0, squash: 0, wobble: Math.random() * 10, slow: 0, poison: 0, poisonTick: 0,
      boss: null,
    };
    e.sprite.setDepth(C.DEPTH.world + y);
    this.enemies.push(e);
    return e;
  }

  private createBoss(arena: Arena): Enemy {
    const b = this.plan.biome;
    const bossNumber = Math.floor(this.plan.level / C.BOSS_EVERY) - 1;
    const hp = Math.round(C.BOSS_BASE_HP * (1 + bossNumber * C.BOSS_HP_GROWTH) * (1 + this.plan.season * 0.8));
    const e = this.createEnemy(b.enemies[0], arena.bossX, arena.bossY);
    e.kind = 'boss';
    e.sprite.setTexture(biomeKey(b, 'boss')).setOrigin(0.5, 0.75);
    e.baseScale = 0.8;
    e.radius = 56;
    e.hp = hp;
    e.maxHp = hp;
    e.speed = 95;
    e.damage = Math.round(24 * this.damageScale());
    e.xp = 60;
    e.flying = false;
    e.boss = {
      name: b.boss.name, patterns: b.boss.patterns, pattern: null, lastPattern: null,
      cooldown: 1.5, step: 0, stepTimer: 0, spin: 0, phase2: false, minion: b.enemies[0],
    };
    return e;
  }

  private damageScale(): number {
    return 0.75 + this.plan.difficulty * 0.25;
  }

  private createEffects(): void {
    const b = this.plan.biome;
    this.dust = this.add.particles(0, 0, 'soft', {
      lifespan: 520, speed: { min: 10, max: 55 }, scale: { start: 0.45, end: 1.1 },
      alpha: { start: 0.55, end: 0 }, tint: toColor(b.groundLight), emitting: false,
    }).setDepth(C.DEPTH.shadow + 1);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 360, speed: { min: 90, max: 280 }, scale: { start: 0.65, end: 0 },
      rotate: { min: 0, max: 360 }, emitting: false,
    }).setDepth(C.DEPTH.overlay - 10);
    this.chunks = this.add.particles(0, 0, 'dot', {
      lifespan: 650, speed: { min: 110, max: 330 }, scale: { start: 1, end: 0.2 },
      gravityY: 520, emitting: false,
    }).setDepth(C.DEPTH.overlay - 11);
    this.createAmbient();
  }

  private createAmbient(): void {
    const b = this.plan.biome;
    const W = C.GAME_WIDTH;
    const H = C.GAME_HEIGHT;
    const configs: Record<string, Phaser.Types.GameObjects.Particles.ParticleEmitterConfig & { texture: string }> = {
      snow: { texture: 'dot', x: { min: -40, max: W }, y: -10, lifespan: 9000, speedX: { min: -15, max: 35 }, speedY: { min: 40, max: 95 }, scale: { min: 0.25, max: 0.7 }, alpha: 0.9, frequency: 45 },
      leaves: { texture: 'leaf', x: { min: -60, max: W }, y: -10, lifespan: 9000, speedX: { min: 20, max: 60 }, speedY: { min: 35, max: 70 }, rotate: { start: 0, end: 540 }, tint: toColor(b.foliageLight), alpha: 0.85, frequency: 260 },
      embers: { texture: 'soft', x: { min: 0, max: W }, y: H + 10, lifespan: 6000, speedX: { min: -20, max: 20 }, speedY: { min: -90, max: -35 }, scale: { start: 0.35, end: 0.05 }, tint: [0xffb03f, 0xff5a1f], blendMode: 'ADD', frequency: 80 },
      dust: { texture: 'soft', x: -20, y: { min: 0, max: H }, lifespan: 8000, speedX: { min: 70, max: 140 }, speedY: { min: -10, max: 10 }, scale: { min: 0.2, max: 0.6 }, tint: toColor(b.groundLight), alpha: { start: 0.4, end: 0 }, frequency: 110 },
      motes: { texture: 'soft', x: { min: 0, max: W }, y: { min: 0, max: H }, lifespan: 4000, speedX: { min: -10, max: 10 }, speedY: { min: -25, max: -5 }, scale: { start: 0.25, end: 0 }, alpha: { start: 0.7, end: 0 }, blendMode: 'ADD', frequency: 140 },
    };
    const { texture, ...config } = configs[b.ambient];
    this.add.particles(0, 0, texture, config).setScrollFactor(0).setDepth(C.DEPTH.overlay - 5);
  }

  private createWorldApi(): void {
    this.world = {
      playerX: 0, playerY: 0,
      minX: this.layout.minX, maxX: this.layout.maxX,
      arenaTop: this.arena?.top ?? 0, arenaBottom: this.arena?.bottom ?? 0,
      fireShot: (x, y, angle, speed, high) => this.fireShot(x, y, angle, speed, high),
      spawnMinion: (kind, x, y) => {
        const m = this.createEnemy(kind, x, y);
        m.awake = true;
        this.puff(x, y, 0xffffff, 10);
      },
      spawnBlast: (x, y, r, delay) => this.spawnBlast(x, y, r, delay),
      countMinions: () => this.enemies.filter((e) => !e.dead && e.awake && e.kind !== 'boss').length,
      shake: (intensity, ms) => this.cameras.main.shake(ms, intensity),
      roar: () => sfx.bossRoar(),
    };
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input is unavailable.');
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.W, down: K.S, left: K.A, right: K.D,
      up2: K.UP, down2: K.DOWN, left2: K.LEFT, right2: K.RIGHT,
      fire: K.SPACE, roll: K.SHIFT, crouch: K.C, crouch2: K.CTRL,
    }) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', () => sfx.unlock());
  }

  // ===========================================================================
  // Главный цикл
  // ===========================================================================

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 1 / 30);

    if (this.mode === 'play') {
      if (this.hitstop > 0) this.hitstop -= dt;
      else this.step(dt);
    } else if (this.mode === 'exit') {
      this.stepExit(dt);
    }

    this.updateHurtOverlay(dt);
    this.hud.update({
      run: this.run,
      stamina: this.player.stamina,
      progress: Phaser.Math.Clamp(1 - (this.player.y - C.EXIT_Y) / (this.plan.length - 130 - C.EXIT_Y), 0, 1),
      boss: this.boss && this.arenaLocked && !this.boss.dead
        ? { name: this.boss.boss?.name ?? '', hp: this.boss.hp, maxHp: this.boss.maxHp }
        : null,
    }, dt);
  }

  private step(dt: number): void {
    this.levelTime += dt;
    this.updatePlayer(dt);
    this.updateCamera(dt);
    this.updateShooting(dt);
    this.updateArrows(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateOrbs(dt);
    this.updateBlasts(dt);
    this.checkArena();
    this.checkExit();
    this.syncPlayer(dt);
  }

  // ===========================================================================
  // Игрок
  // ===========================================================================

  private has(id: AbilityId): boolean {
    return this.run.abilities.includes(id);
  }

  private playerRadius(): number {
    return C.PLAYER_RADIUS * (this.player.crouch ? C.CROUCH_RADIUS_MUL : 1);
  }

  private moveInput(): { x: number; y: number } {
    const k = this.keys;
    const x = (k.right.isDown || k.right2.isDown ? 1 : 0) - (k.left.isDown || k.left2.isDown ? 1 : 0);
    const y = (k.down.isDown || k.down2.isDown ? 1 : 0) - (k.up.isDown || k.up2.isDown ? 1 : 0);
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const run = this.run;
    const move = this.moveInput();
    const pointer = this.input.activePointer;

    p.invuln -= dt;
    p.staminaDelay -= dt;

    if (p.roll > 0) {
      this.updateRoll(dt);
    } else {
      p.crouch = this.keys.crouch.isDown || this.keys.crouch2.isDown || pointer.rightButtonDown();
      if (Phaser.Input.Keyboard.JustDown(this.keys.roll)) this.tryRoll(move.x, move.y);

      const pool = this.poolAt(p.x, p.y);
      const speed = C.PLAYER_BASE_SPEED * run.speedMul
        * (p.crouch ? C.CROUCH_SPEED_MUL : 1)
        * (pool ? C.POOL_SLOW_MUL : 1);
      const k = Math.min(1, dt * C.PLAYER_ACCEL);
      p.vx += (move.x * speed - p.vx) * k;
      p.vy += (move.y * speed - p.vy) * k;

      if (pool && this.plan.biome.poolHurts) this.hurtPlayer(C.LAVA_DPS * 0.4);

      if (p.staminaDelay <= 0) {
        const regen = p.crouch ? C.STAMINA_REGEN_CROUCH : C.STAMINA_REGEN;
        p.stamina = Math.min(run.maxStamina, p.stamina + regen * dt);
      }

      const moving = Math.hypot(p.vx, p.vy);
      if (moving > 30) {
        p.walk += dt * moving * 0.055;
        p.dustTimer -= dt;
        if (p.dustTimer <= 0) {
          p.dustTimer = p.crouch ? 0.3 : 0.16;
          this.dust.emitParticleAt(p.x, p.y, 1);
        }
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collidePlayer();
  }

  private tryRoll(mx: number, my: number): void {
    const p = this.player;
    const cost = C.ROLL_COST * (this.has('lightRoll') ? C.LIGHT_ROLL_COST_MUL : 1);
    if (p.stamina < cost) {
      this.popText(p.x, p.y - 40, '…', '#ffd060', 18);
      return;
    }
    const dx = mx === 0 && my === 0 ? 0 : mx;
    const dy = mx === 0 && my === 0 ? -1 : my;
    p.roll = C.ROLL_DURATION;
    p.rollDx = dx;
    p.rollDy = dy;
    p.rollHits.clear();
    p.crouch = false;
    p.stamina -= cost;
    p.staminaDelay = C.STAMINA_REGEN_DELAY;
    p.burstLeft = 0;
    sfx.roll();
    this.dust.explode(8, p.x, p.y);

    if (this.has('frostRoll')) this.frostNova();
  }

  private updateRoll(dt: number): void {
    const p = this.player;
    p.roll -= dt;
    const t = 1 - p.roll / C.ROLL_DURATION;
    const speed = C.ROLL_SPEED * (1 - t * 0.55);
    p.vx = p.rollDx * speed;
    p.vy = p.rollDy * speed;
    if (Math.random() < 0.6) this.dust.emitParticleAt(p.x, p.y, 1);

    if (this.has('shockRoll')) {
      for (const e of this.enemies) {
        if (e.dead || p.rollHits.has(e)) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + C.PLAYER_RADIUS + 6) {
          p.rollHits.add(e);
          this.hitEnemy(e, C.SHOCK_ROLL_DAMAGE * this.run.damageMul, p.rollDx, p.rollDy);
        }
      }
    }

    if (p.roll <= 0) {
      p.squash = 0.2;
      if (this.has('echoRoll')) this.fireRing(C.RING_DAMAGE_MUL);
    }
  }

  private frostNova(): void {
    const p = this.player;
    sfx.frost();
    const ring = this.add.image(p.x, p.y, 'ring').setTint(0x9fe0ff).setDepth(C.DEPTH.overlay - 12).setScale(0.2);
    this.tweens.add({
      targets: ring,
      scale: (C.FROST_ROLL_RADIUS * 2) / 128,
      alpha: 0,
      duration: 380,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
    this.sparks.particleTint = 0xbff0ff;
    this.sparks.explode(14, p.x, p.y);
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < C.FROST_ROLL_RADIUS) e.slow = C.FROST_SLOW_TIME;
    }
  }

  private collidePlayer(): void {
    const p = this.player;
    const r = this.playerRadius();
    this.pushOutOfObstacles(p, r);

    if (!p.crouch && p.roll <= 0) {
      for (const beam of this.beams) this.pushOutOfBeam(p, r, beam);
    }

    p.x = Phaser.Math.Clamp(p.x, this.layout.minX - 10 + r, this.layout.maxX + 10 - r);
    const cam = this.cameras.main;
    const bottom = cam.scrollY + C.GAME_HEIGHT - r - 6;
    if (p.y > bottom) {
      p.y = bottom;
      p.vy = Math.min(p.vy, 0);
    }
    if (this.gate && this.arena && this.boss && !this.boss.dead) {
      p.y = Math.max(p.y, this.arena.gateY + 20 + r);
    }
  }

  private pushOutOfObstacles(o: { x: number; y: number }, r: number): boolean {
    let hit = false;
    for (const ob of this.obstacles) {
      const dy = o.y - ob.y;
      const min = ob.r + r;
      if (dy > min || dy < -min) continue;
      const dx = o.x - ob.x;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 0.001) continue;
      o.x = ob.x + (dx / d) * min;
      o.y = ob.y + (dy / d) * min;
      hit = true;
    }
    return hit;
  }

  private pushOutOfBeam(o: { x: number; y: number }, r: number, beam: Beam): void {
    const top = beam.y - BEAM_HALF_THICKNESS;
    const bottom = beam.y + BEAM_HALF_THICKNESS;
    const cx = Phaser.Math.Clamp(o.x, beam.x1, beam.x2);
    const cy = Phaser.Math.Clamp(o.y, top, bottom);
    const dx = o.x - cx;
    const dy = o.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= r) return;
    if (d < 0.001) {
      o.y = o.y < beam.y ? top - r : bottom + r;
      return;
    }
    o.x = cx + (dx / d) * r;
    o.y = cy + (dy / d) * r;
  }

  private poolAt(x: number, y: number): Pool | null {
    for (const pool of this.pools) {
      const nx = (x - pool.x) / pool.rx;
      const ny = (y - pool.y) / pool.ry;
      if (nx * nx + ny * ny < 0.8) return pool;
    }
    return null;
  }

  private syncPlayer(dt: number): void {
    const p = this.player;
    p.crouchK += ((p.crouch ? 1 : 0) - p.crouchK) * Math.min(1, dt * 18);
    p.squash *= Math.max(0, 1 - dt * 10);

    const moving = Math.hypot(p.vx, p.vy) > 30 && p.roll <= 0;
    const bob = moving ? Math.abs(Math.sin(p.walk)) * 3 : 0;
    const sx = 1 + p.crouchK * 0.14 - p.squash * 0.5;
    const sy = 1 - p.crouchK * 0.3 + p.squash;

    p.sprite.setPosition(p.x, p.y - bob).setScale(sx, sy).setDepth(C.DEPTH.world + p.y);
    if (p.roll > 0) {
      const t = 1 - p.roll / C.ROLL_DURATION;
      p.sprite.setRotation(t * Math.PI * 2 * (p.rollDx < 0 ? -1 : 1));
    } else {
      p.sprite.setRotation(moving ? Math.sin(p.walk) * 0.07 : 0);
    }
    if (Math.abs(p.vx) > 20) p.sprite.setFlipX(p.vx < 0);

    const blink = p.invuln > 0 && p.roll <= 0 && Math.floor(this.time.now / 60) % 2 === 0;
    p.sprite.setAlpha(blink ? 0.45 : 1);
    p.shadow.setPosition(p.x, p.y).setScale(0.55 + p.crouchK * 0.1, 0.55);

    const bowDist = 12;
    p.bow
      .setVisible(p.roll <= 0)
      .setPosition(p.x + Math.cos(p.aim) * bowDist, p.y - 20 + p.crouchK * 8 + Math.sin(p.aim) * bowDist)
      .setRotation(p.aim)
      .setDepth(C.DEPTH.world + p.y + 1);
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    if (this.arenaLocked && this.arena) {
      cam.scrollY += (this.arena.top - cam.scrollY) * Math.min(1, dt * 4);
      return;
    }
    const target = Phaser.Math.Clamp(this.player.y - C.GAME_HEIGHT * C.CAMERA_ANCHOR, 0, this.plan.length - C.GAME_HEIGHT);
    // Камера едет только вверх — назад пути нет.
    if (target < cam.scrollY) cam.scrollY += (target - cam.scrollY) * Math.min(1, dt * 10);
  }

  private hurtPlayer(amount: number, fromX?: number, fromY?: number): void {
    const p = this.player;
    if (p.roll > 0 || p.invuln > 0 || this.mode !== 'play') return;
    const dmg = Math.round(amount * (this.has('shelter') && p.crouch ? C.SHELTER_DAMAGE_MUL : 1));
    this.run.hp -= dmg;
    p.invuln = C.HURT_INVULNERABILITY;
    if (fromX !== undefined && fromY !== undefined) {
      const a = Math.atan2(p.y - fromY, p.x - fromX);
      p.vx += Math.cos(a) * 320;
      p.vy += Math.sin(a) * 320;
    }
    p.squash = -0.25;
    sfx.hurt();
    this.cameras.main.shake(180, 0.012);
    this.hurtFlash = 0.85;
    this.hitstop = Math.max(this.hitstop, 0.06);
    this.popText(p.x, p.y - 44, `-${dmg}`, '#ff4f5f', 22);
    if (this.run.hp <= 0) this.die();
  }

  private updateHurtOverlay(dt: number): void {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    const low = this.run.hp / this.run.maxHp < 0.3 && this.mode === 'play';
    const pulse = low ? 0.25 + Math.sin(this.time.now / 180) * 0.15 : 0;
    this.hurtOverlay.setAlpha(Math.max(this.hurtFlash, pulse));
  }

  // ===========================================================================
  // Стрельба
  // ===========================================================================

  private updateShooting(dt: number): void {
    const p = this.player;
    p.fireCooldown -= dt;

    if (p.burstLeft > 0) {
      p.burstTimer -= dt;
      if (p.burstTimer <= 0) {
        p.burstLeft -= 1;
        p.burstTimer = C.BURST_DELAY;
        this.fireSet(p.burstAngle);
      }
    }

    const pointer = this.input.activePointer;
    const wantFire = this.keys.fire.isDown || pointer.leftButtonDown();
    if (!wantFire || p.roll > 0 || p.fireCooldown > 0) return;

    sfx.unlock();
    p.fireCooldown = C.FIRE_INTERVAL / this.run.fireRateMul;
    const angle = this.aimAngle(pointer.leftButtonDown());
    p.aim = angle;
    p.volley += 1;
    this.fireSet(angle);
    p.burstLeft = this.run.burst - 1;
    p.burstTimer = C.BURST_DELAY;
    p.burstAngle = angle;
    if (this.run.ring && p.volley % C.RING_EVERY_VOLLEYS === 0) this.fireRing(C.RING_DAMAGE_MUL);
    p.squash = -0.1;
  }

  /** Мышь — стрельба в курсор; пробел — автоприцел в ближайшего врага, иначе вперёд. */
  private aimAngle(useMouse: boolean): number {
    const p = this.player;
    if (useMouse) {
      const pointer = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      return Math.atan2(wp.y - (p.y - ARROW_HEIGHT), wp.x - p.x);
    }
    const target = this.nearestEnemy(p.x, p.y, C.AUTO_AIM_RANGE, []);
    return target ? Math.atan2(target.y - p.y, target.x - p.x) : -Math.PI / 2;
  }

  private nearestEnemy(x: number, y: number, range: number, exclude: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of this.enemies) {
      if (e.dead || !e.awake || exclude.includes(e)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private fireSet(angle: number): void {
    const p = this.player;
    const angles = this.run.spread ? [angle - C.SPREAD_ANGLE, angle, angle + C.SPREAD_ANGLE] : [angle];
    for (const a of angles) this.spawnArrow(p.x, p.y, a, 1);
    sfx.shoot();
  }

  private fireRing(damageMul: number): void {
    const p = this.player;
    for (let i = 0; i < C.RING_ARROWS; i++) {
      this.spawnArrow(p.x, p.y, (i / C.RING_ARROWS) * Math.PI * 2 - Math.PI / 2, damageMul);
    }
    this.sparks.particleTint = 0xffe08a;
    this.sparks.explode(8, p.x, p.y - ARROW_HEIGHT);
  }

  private spawnArrow(x: number, y: number, angle: number, damageMul: number): void {
    const sprite = this.add.image(x, y - ARROW_HEIGHT, 'arrow').setOrigin(0.85, 0.5).setRotation(angle);
    const shadow = this.add.image(x, y, 'shadow').setScale(0.3, 0.2).setDepth(C.DEPTH.shadow).setAlpha(0.6);
    this.arrows.push({
      x, y,
      vx: Math.cos(angle) * C.ARROW_SPEED,
      vy: Math.sin(angle) * C.ARROW_SPEED,
      life: C.ARROW_LIFETIME,
      damage: C.ARROW_DAMAGE * this.run.damageMul * damageMul,
      pierce: this.has('pierce') ? 1 : 0,
      bounces: this.has('ricochet') ? 1 : 0,
      hits: [], stuck: 0, sprite, shadow,
    });
  }

  private updateArrows(dt: number): void {
    const cam = this.cameras.main;
    for (const a of this.arrows) {
      if (a.stuck > 0) {
        a.stuck -= dt;
        a.sprite.setAlpha(Math.min(1, a.stuck * 3));
        if (a.stuck <= 0) a.life = 0;
        continue;
      }
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.life -= dt;

      const offscreen = a.y < cam.scrollY - 40 || a.y > cam.scrollY + C.GAME_HEIGHT + 40 || a.x < 0 || a.x > C.GAME_WIDTH;
      if (offscreen) a.life = 0;
      if (a.life <= 0) continue;

      if (this.obstacles.some((o) => Math.hypot(o.x - a.x, o.y - a.y) < o.r)) {
        a.stuck = 0.6;
        a.shadow.setVisible(false);
        this.sparks.particleTint = 0xfff0c0;
        this.sparks.explode(3, a.x, a.y - ARROW_HEIGHT);
        continue;
      }

      for (const e of this.enemies) {
        if (e.dead || a.hits.includes(e) || (e.kind === 'boss' && !e.awake)) continue;
        if (Math.hypot(e.x - a.x, e.y - a.y) > e.radius + C.ARROW_RADIUS) continue;
        a.hits.push(e);
        const speed = Math.hypot(a.vx, a.vy);
        this.hitEnemy(e, a.damage, a.vx / speed, a.vy / speed);
        if (a.pierce > 0) {
          a.pierce -= 1;
        } else if (a.bounces > 0) {
          a.bounces -= 1;
          this.redirectArrow(a);
        } else {
          a.life = 0;
        }
        break;
      }

      a.sprite.setPosition(a.x, a.y - ARROW_HEIGHT).setDepth(C.DEPTH.world + a.y);
      a.shadow.setPosition(a.x, a.y);
    }
    this.arrows = this.arrows.filter((a) => {
      if (a.life > 0 || a.stuck > 0) return true;
      a.sprite.destroy();
      a.shadow.destroy();
      return false;
    });
  }

  private redirectArrow(a: Arrow): void {
    const next = this.nearestEnemy(a.x, a.y, 320, a.hits);
    if (!next) {
      a.life = 0;
      return;
    }
    const angle = Math.atan2(next.y - a.y, next.x - a.x);
    a.vx = Math.cos(angle) * C.ARROW_SPEED;
    a.vy = Math.sin(angle) * C.ARROW_SPEED;
    a.life = C.ARROW_LIFETIME;
    a.sprite.setRotation(angle);
    this.sparks.particleTint = 0x7fb8ff;
    this.sparks.explode(4, a.x, a.y - ARROW_HEIGHT);
  }

  // ===========================================================================
  // Враги
  // ===========================================================================

  private updateEnemies(dt: number): void {
    const p = this.player;
    const cam = this.cameras.main;
    this.world.playerX = p.x;
    this.world.playerY = p.y;
    const pr = this.playerRadius();

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (!e.awake) {
        if (e.kind !== 'boss' && this.levelTime > C.START_GRACE && e.y > cam.scrollY + C.WAKE_INSET && e.y < cam.scrollY + C.GAME_HEIGHT) this.wake(e);
        this.syncEnemy(e, dt);
        continue;
      }

      const mul = e.slow > 0 ? C.FROST_SLOW_MUL : 1;
      e.slow -= dt;
      this.updatePoison(e, dt);
      if (e.dead) continue;

      e.bumped = false;
      thinkEnemy(e, this.world, dt * mul);
      e.x += (e.vx * mul + e.kx) * dt;
      e.y += (e.vy * mul + e.ky) * dt;
      const damp = Math.max(0, 1 - dt * 10);
      e.kx *= damp;
      e.ky *= damp;
      this.collideEnemy(e);

      const reach = e.radius + pr - 4;
      if (e.hop < 8 && Math.abs(e.x - p.x) < reach && Math.abs(e.y - p.y) < reach && Math.hypot(e.x - p.x, e.y - p.y) < reach) {
        this.hurtPlayer(e.damage, e.x, e.y);
      }
      this.syncEnemy(e, dt);
    }

    this.separateEnemies();
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private wake(e: Enemy): void {
    e.awake = true;
    e.squash = 0.35;
    this.popText(e.x, e.y - 46, '!', '#ffd23f', 22);
  }

  private updatePoison(e: Enemy, dt: number): void {
    if (e.poison <= 0) return;
    e.poison -= dt;
    e.poisonTick -= dt;
    if (e.poisonTick > 0) return;
    e.poisonTick = 0.5;
    this.hitEnemy(e, C.POISON_DPS * 0.5 * this.run.damageMul, 0, 0, true);
  }

  private collideEnemy(e: Enemy): void {
    if (!e.flying && this.pushOutOfObstacles(e, e.radius * 0.8)) e.bumped = true;
    const minX = this.layout.minX + e.radius * 0.5;
    const maxX = this.layout.maxX - e.radius * 0.5;
    if (e.x < minX || e.x > maxX) {
      e.x = Phaser.Math.Clamp(e.x, minX, maxX);
      e.bumped = true;
    }
    if (e.kind === 'boss' && this.arena) {
      const top = this.arena.gateY + 90;
      const bottom = this.arena.bottom - 70;
      if (e.y < top || e.y > bottom) {
        e.y = Phaser.Math.Clamp(e.y, top, bottom);
        e.bumped = true;
      }
    }
  }

  private separateEnemies(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || !a.awake) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || !b.awake || a.flying !== b.flying) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.85;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy) || 1;
        if (d >= min) continue;
        const push = (min - d) / 2;
        const wa = a.kind === 'boss' ? 0 : 1;
        const wb = b.kind === 'boss' ? 0 : 1;
        a.x -= (dx / d) * push * wa;
        a.y -= (dy / d) * push * wa;
        b.x += (dx / d) * push * wb;
        b.y += (dy / d) * push * wb;
      }
    }
  }

  private syncEnemy(e: Enemy, dt: number): void {
    e.flash -= dt;
    e.squash *= Math.max(0, 1 - dt * 9);
    const moving = Math.hypot(e.vx, e.vy) > 10;
    const fly = e.flying ? 20 + Math.sin(e.wobble * 6) * 5 : 0;
    const walk = moving && !e.flying ? Math.abs(Math.sin(e.wobble * 14)) * 2.5 : 0;
    const idle = !e.awake ? Math.sin(e.wobble + this.time.now / 400) * 0.03 : 0;
    const s = e.baseScale;

    e.sprite
      .setPosition(e.x, e.y - e.hop - fly - walk)
      .setScale(s * (1 + e.squash * 0.6 - idle), s * (1 - e.squash + idle))
      .setDepth(C.DEPTH.world + e.y);
    if (e.flying) e.sprite.setRotation(Math.sin(e.wobble * 12) * 0.12);

    // Замах перед тараном — мигание красным, чтобы успеть увернуться.
    const windup = e.state === 'windup' && Math.floor(this.time.now / 90) % 2 === 0;
    if (e.flash > 0) e.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else if (windup) e.sprite.setTint(0xff5a4a).setTintMode(Phaser.TintModes.FILL);
    else if (e.slow > 0) e.sprite.setTint(0x9fe0ff).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (e.poison > 0) e.sprite.setTint(0xa8ff8a).setTintMode(Phaser.TintModes.MULTIPLY);
    else e.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);

    const lift = (e.hop + fly) / 90;
    e.shadow.setPosition(e.x, e.y).setScale((e.radius * 2.4 / 64) * (1 - lift), (e.radius * 2.4 / 64) * (1 - lift) * 0.9);
  }

  private hitEnemy(e: Enemy, damage: number, dirX: number, dirY: number, isPoison = false): void {
    if (e.dead) return;
    if (!e.awake && e.kind !== 'boss') this.wake(e);
    const dmg = Math.max(1, Math.round(damage));
    e.hp -= dmg;
    e.flash = isPoison || e.kind === 'boss' ? 0.04 : 0.09;
    e.squash = isPoison ? 0.1 : 0.28;
    if (e.kind !== 'boss') {
      e.kx += dirX * 220;
      e.ky += dirY * 220;
    }
    if (!isPoison && this.has('poison')) e.poison = C.POISON_TIME;

    this.popText(e.x + Phaser.Math.Between(-10, 10), e.y - 40 - e.hop, `${dmg}`, isPoison ? '#a8ff8a' : '#ffffff', isPoison ? 14 : 18);
    if (!isPoison) {
      sfx.hit();
      this.hitstop = Math.max(this.hitstop, C.HITSTOP_HIT);
      this.sparks.particleTint = 0xffffff;
      this.sparks.explode(4, e.x, e.y - 14);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    this.run.kills += 1;
    const tint = ENEMY_TINT[e.kind];

    this.chunks.particleTint = tint;
    this.chunks.explode(e.kind === 'boss' ? 60 : 14, e.x, e.y - 16);
    this.sparks.particleTint = 0xfff6c0;
    this.sparks.explode(e.kind === 'boss' ? 30 : 6, e.x, e.y - 16);
    this.dust.explode(6, e.x, e.y);

    const sprite = e.sprite;
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.tweens.add({
      targets: sprite,
      scaleX: e.baseScale * 1.5,
      scaleY: e.baseScale * 0.2,
      alpha: 0,
      duration: 160,
      onComplete: () => sprite.destroy(),
    });
    e.shadow.destroy();

    const orbCount = Math.min(14, Math.ceil(e.xp / 2));
    for (let i = 0; i < orbCount; i++) this.spawnOrb(e.x, e.y, e.xp / orbCount);

    sfx.kill();
    this.cameras.main.shake(90, 0.004);
    this.hitstop = Math.max(this.hitstop, C.HITSTOP_KILL);

    if (this.has('vampire') && this.run.hp < this.run.maxHp) {
      this.run.hp = Math.min(this.run.maxHp, this.run.hp + C.VAMPIRE_HEAL);
      this.popText(this.player.x, this.player.y - 50, `+${C.VAMPIRE_HEAL}`, '#7fff9f', 16);
    }

    if (e.kind === 'blob' && !e.small) {
      for (const s of [-1, 1]) {
        const child = this.createEnemy('blob', e.x + s * 18, e.y, true);
        child.awake = true;
        child.kx = s * 200;
      }
    }

    if (e.kind === 'boss') this.onBossDefeated(e);
  }

  // ===========================================================================
  // Снаряды врагов и взрывы
  // ===========================================================================

  private fireShot(x: number, y: number, angle: number, speed: number, high: boolean): void {
    const sprite = this.add.image(x, y, high ? 'shot_high' : 'shot_low');
    const shadow = this.add.image(x, y, 'shadow').setDepth(C.DEPTH.shadow).setScale(high ? 0.3 : 0.35, high ? 0.22 : 0.3);
    this.shots.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      high,
      damage: Math.round((high ? 14 : 10) * this.damageScale()),
      life: SHOT_LIFETIME,
      sprite, shadow,
    });
    if (this.time.now - this.lastShotSfx > 70) {
      this.lastShotSfx = this.time.now;
      sfx.enemyShot(high);
    }
  }

  private updateShots(dt: number): void {
    const p = this.player;
    const cam = this.cameras.main;
    const pr = this.playerRadius();
    const t = this.time.now / 1000;

    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.y > cam.scrollY + C.GAME_HEIGHT + 60 || s.y < cam.scrollY - 200 || s.x < 0 || s.x > C.GAME_WIDTH) s.life = 0;
      if (!s.high && this.obstacles.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < o.r)) {
        s.life = 0;
        this.dust.explode(3, s.x, s.y);
      }
      if (s.life <= 0) continue;

      if (Math.hypot(s.x - p.x, s.y - p.y) < pr + C.ENEMY_SHOT_RADIUS) {
        const ducked = s.high && p.crouch;
        if (!ducked && p.roll <= 0 && p.invuln <= 0) {
          this.hurtPlayer(s.damage, s.x, s.y);
          s.life = 0;
          continue;
        }
      }
      const h = s.high ? C.HIGH_SHOT_HEIGHT : 8;
      s.sprite.setPosition(s.x, s.y - h).setDepth(C.DEPTH.world + s.y + (s.high ? 40 : 0)).setScale(1 + Math.sin(t * 20 + s.x) * 0.08);
      s.shadow.setPosition(s.x, s.y);
    }
    this.shots = this.shots.filter((s) => {
      if (s.life > 0) return true;
      s.sprite.destroy();
      s.shadow.destroy();
      return false;
    });
  }

  private clearShots(): void {
    for (const s of this.shots) {
      this.sparks.particleTint = s.high ? 0xffb03f : 0xd27bff;
      this.sparks.explode(2, s.x, s.y);
      s.life = 0;
    }
  }

  private spawnBlast(x: number, y: number, r: number, delay: number): void {
    const fill = this.add.image(x, y, 'disc').setTint(0xff3f3f).setScale(0).setDepth(C.DEPTH.pool + 1);
    const ring = this.add.image(x, y, 'ring').setTint(0xff3f3f).setScale((r * 2) / 128).setDepth(C.DEPTH.pool + 1).setAlpha(0.8);
    this.blasts.push({ x, y, r, timer: delay, delay, ring, fill });
    sfx.telegraph();
  }

  private updateBlasts(dt: number): void {
    const p = this.player;
    for (const b of this.blasts) {
      b.timer -= dt;
      b.fill.setScale(((1 - b.timer / b.delay) * b.r * 2) / 128);
      b.ring.setAlpha(0.5 + Math.sin(this.time.now / 50) * 0.3);
      if (b.timer > 0) continue;

      sfx.boom();
      this.cameras.main.shake(160, 0.01);
      this.chunks.particleTint = 0xff7a2f;
      this.chunks.explode(16, b.x, b.y);
      this.dust.explode(10, b.x, b.y);
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + C.PLAYER_RADIUS) {
        this.hurtPlayer(Math.round(20 * this.damageScale()), b.x, b.y);
      }
    }
    this.blasts = this.blasts.filter((b) => {
      if (b.timer > 0) return true;
      b.ring.destroy();
      b.fill.destroy();
      return false;
    });
  }

  // ===========================================================================
  // Опыт
  // ===========================================================================

  private spawnOrb(x: number, y: number, value: number): void {
    const a = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    this.orbs.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      z: 10, vz: 160 + Math.random() * 140,
      value, age: 0,
      sprite: this.add.image(x, y, 'orb'),
      shadow: this.add.image(x, y, 'shadow').setScale(0.22, 0.16).setDepth(C.DEPTH.shadow),
    });
  }

  private updateOrbs(dt: number, magnetAll = false): void {
    const p = this.player;
    this.pickupStreakTimer -= dt;
    if (this.pickupStreakTimer <= 0) this.pickupStreak = 0;

    for (const o of this.orbs) {
      o.age += dt;
      o.vz -= ORB_GRAVITY * dt;
      o.z += o.vz * dt;
      if (o.z < 0) {
        o.z = 0;
        o.vz = -o.vz * 0.45;
      }

      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (o.age > 0.35 && (magnetAll || d < C.XP_MAGNET_RADIUS)) {
        const pull = 340 + o.age * 300;
        o.vx += ((dx / d) * pull - o.vx) * Math.min(1, dt * 8);
        o.vy += ((dy / d) * pull - o.vy) * Math.min(1, dt * 8);
      } else {
        const f = Math.max(0, 1 - dt * 3);
        o.vx *= f;
        o.vy *= f;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;

      if (o.age > 0.3 && d < C.XP_PICKUP_RADIUS) {
        this.collectOrb(o);
        continue;
      }
      o.sprite
        .setPosition(o.x, o.y - 8 - o.z - Math.sin(o.age * 6) * 2)
        .setRotation(Math.sin(o.age * 5) * 0.3)
        .setDepth(C.DEPTH.world + o.y);
      o.shadow.setPosition(o.x, o.y);
    }
    this.orbs = this.orbs.filter((o) => o.value > 0);
  }

  private collectOrb(o: Orb): void {
    this.run.xp += o.value;
    o.value = 0;
    o.sprite.destroy();
    o.shadow.destroy();
    sfx.pickup(this.pickupStreak);
    this.pickupStreak += 1;
    this.pickupStreakTimer = 0.45;
    this.hud.pulseXp();
    this.sparks.particleTint = 0x9cffd6;
    this.sparks.emitParticleAt(this.player.x, this.player.y - 20, 1);

    while (this.run.xp >= this.run.xpNeeded) {
      this.run.xp -= this.run.xpNeeded;
      this.run.xpNeeded = this.computeXpNeeded();
      this.pendingUpgrades += 1;
    }
    if (this.pendingUpgrades > 0 && this.mode === 'play') {
      this.levelUpBurst();
      this.runChoices(() => this.resumePlay());
    }
  }

  private levelUpBurst(): void {
    const p = this.player;
    sfx.levelUp();
    this.sparks.particleTint = 0x9cffd6;
    this.sparks.explode(20, p.x, p.y - 20);
    const ring = this.add.image(p.x, p.y, 'ring').setTint(0x9cffd6).setScale(0.1).setDepth(C.DEPTH.overlay - 12);
    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
  }

  // ===========================================================================
  // Выбор усилений и абилок
  // ===========================================================================

  /** Показывает все накопленные выборы по очереди: сначала абилку за босса, потом усиления. */
  private runChoices(onDone: () => void): void {
    if (this.pendingAbility) {
      this.pendingAbility = false;
      const options = rollChoices(ABILITIES, this.run);
      if (options.length > 0) {
        this.mode = 'choice';
        showChoice(this, 'Награда за босса — новая абилка', options, (c) => {
          c.apply(this.run);
          this.runChoices(onDone);
        });
        return;
      }
    }
    if (this.pendingUpgrades > 0) {
      this.pendingUpgrades -= 1;
      this.mode = 'choice';
      showChoice(this, 'Новое усиление', rollChoices(UPGRADES, this.run), (c) => {
        c.apply(this.run);
        this.player.stamina = Math.min(this.player.stamina, this.run.maxStamina);
        this.runChoices(onDone);
      });
      return;
    }
    onDone();
  }

  private resumePlay(): void {
    this.mode = 'play';
    this.player.invuln = Math.max(this.player.invuln, 0.8);
  }

  // ===========================================================================
  // Босс, выход, смерть
  // ===========================================================================

  private checkArena(): void {
    if (!this.arena || !this.boss || this.arenaLocked) return;
    if (this.player.y > this.arena.bottom - 50) return;
    this.arenaLocked = true;
    const boss = this.boss;
    sfx.bossRoar();
    this.cameras.main.shake(700, 0.012);
    this.showBanner(boss.boss?.name ?? '', 'Босс');
    boss.squash = 0.4;
    this.time.delayedCall(1300, () => {
      boss.awake = true;
    });
  }

  private onBossDefeated(boss: Enemy): void {
    this.hitstop = C.HITSTOP_BOSS_KILL;
    this.cameras.main.shake(900, 0.02);
    this.cameras.main.flash(300, 255, 240, 200);
    sfx.bossRoar();
    this.clearShots();
    for (const b of this.blasts) {
      b.ring.destroy();
      b.fill.destroy();
    }
    this.blasts = [];
    for (const e of this.enemies) {
      if (!e.dead && e !== boss) this.killEnemy(e);
    }
    for (let i = 0; i < 4; i++) {
      this.time.delayedCall(i * 160, () => {
        this.chunks.particleTint = [0xffd23f, 0xff5a4a, 0x3fe0a8, 0x7fb8ff][i];
        this.chunks.explode(24, boss.x + Phaser.Math.Between(-50, 50), boss.y - Phaser.Math.Between(10, 60));
      });
    }

    this.time.delayedCall(700, () => {
      sfx.gateOpen();
      if (this.gate) {
        this.tweens.add({ targets: this.gate, scaleY: 0, alpha: 0, duration: 600, ease: 'Back.In' });
      }
    });

    this.pendingAbility = true;
    this.time.delayedCall(1400, () => {
      if (this.mode === 'play') this.runChoices(() => this.resumePlay());
    });
  }

  private checkExit(): void {
    if (this.exitStarted || this.player.y > C.EXIT_Y + 30) return;
    if (this.boss && !this.boss.dead) return;
    this.exitStarted = true;
    this.mode = 'exit';
    this.exitTimer = 0;
    sfx.gateOpen();
    const colors = [0xff5a4a, 0xffd23f, 0x3fe0a8, 0x7fb8ff, 0xff7fbf];
    colors.forEach((c, i) => {
      this.time.delayedCall(i * 90, () => {
        this.chunks.particleTint = c;
        this.chunks.explode(14, C.GAME_WIDTH / 2 + Phaser.Math.Between(-30, 30), C.EXIT_Y - 70);
      });
    });
  }

  private stepExit(dt: number): void {
    const p = this.player;
    this.exitTimer += dt;
    p.vx = (C.GAME_WIDTH / 2 - p.x) * 2;
    p.vy = (C.EXIT_Y - 6 - p.y) * 2;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.crouch = false;
    p.roll = 0;
    this.updateArrows(dt);
    this.updateOrbs(dt, true);
    this.syncPlayer(dt);

    if (this.exitTimer < EXIT_DURATION) return;
    this.exitTimer = -999;
    this.runChoices(() => this.finishLevel());
  }

  private finishLevel(): void {
    this.mode = 'exit';
    const run = this.run;
    run.level += 1;
    run.hp = Math.min(run.maxHp, run.hp + run.maxHp * 0.1);
    if (run.level > C.LEVELS_PER_SEASON) {
      this.showSeasonEnd();
      return;
    }
    saveRun(run);
    const cam = this.cameras.main;
    cam.fadeOut(450, 20, 10, 30);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ run }));
  }

  private die(): void {
    this.mode = 'dead';
    const p = this.player;
    clearRun();
    sfx.death();
    this.cameras.main.shake(400, 0.02);
    this.hurtFlash = 1;
    p.bow.setVisible(false);
    this.tweens.add({ targets: p.sprite, angle: 90, scaleY: 0.6, duration: 500, ease: 'Bounce.Out' });
    this.chunks.particleTint = 0xff4f5f;
    this.chunks.explode(20, p.x, p.y - 16);

    this.time.delayedCall(900, () => {
      const season = getSeason(this.run.season);
      this.showPanel(
        'Экспедиция окончена',
        `${this.plan.biome.name} · уровень ${this.run.level}/${C.LEVELS_PER_SEASON}\nСезон «${season.name}» · врагов повержено: ${this.run.kills}`,
        'Заново',
        () => this.scene.restart({ run: newRun(this.run.season) }),
      );
    });
  }

  private showSeasonEnd(): void {
    this.mode = 'end';
    clearRun();
    const season = getSeason(this.run.season);
    const next = getSeason(this.run.season + 1);
    sfx.levelUp();
    this.showPanel(
      'Вершина покорена!',
      `Сезон «${season.name}» пройден · врагов повержено: ${this.run.kills}\nДальше — сезон «${next.name}»: всё заново и в новой стилистике.`,
      'Новый сезон',
      () => this.scene.restart({ run: newRun(this.run.season + 1) }),
    );
  }

  // ===========================================================================
  // UI-эффекты
  // ===========================================================================

  private popText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add.text(x, y, text, {
      fontFamily: C.FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(C.DEPTH.overlay - 1).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, delay: 200, duration: 450, ease: 'Quad.In', onComplete: () => t.destroy() });
  }

  private puff(x: number, y: number, tint: number, count: number): void {
    this.chunks.particleTint = tint;
    this.chunks.explode(count, x, y);
    this.dust.explode(count, x, y);
  }

  private showBanner(title?: string, subtitle?: string): void {
    const plan = this.plan;
    const main = title ?? plan.biome.name;
    const sub = subtitle ?? (plan.isBoss ? `Уровень ${plan.level} · логово босса` : `Уровень ${plan.level} из ${C.LEVELS_PER_SEASON}`);
    const style = { fontFamily: C.FONT, fontStyle: 'bold', stroke: '#1a1020' };
    const big = this.add.text(C.GAME_WIDTH / 2, 190, main, { ...style, fontSize: '54px', color: '#fff6dc', strokeThickness: 8 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.hud + 5).setAlpha(0).setScale(1.4);
    const small = this.add.text(C.GAME_WIDTH / 2, 246, sub, { ...style, fontSize: '20px', color: '#ffd8a0', strokeThickness: 5 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.hud + 5).setAlpha(0);
    this.tweens.add({ targets: big, alpha: 1, scale: 1, duration: 420, ease: 'Back.Out' });
    this.tweens.add({ targets: small, alpha: 1, duration: 300, delay: 200 });
    this.tweens.add({
      targets: [big, small], alpha: 0, y: '-=20', delay: 1800, duration: 500,
      onComplete: () => { big.destroy(); small.destroy(); },
    });
  }

  private showPanel(title: string, body: string, action: string, onAction: () => void): void {
    const cx = C.GAME_WIDTH / 2;
    const cy = C.GAME_HEIGHT / 2;
    const style = { fontFamily: C.FONT, fontStyle: 'bold', stroke: '#1a1020', align: 'center' };
    const dim = this.add.rectangle(cx, cy, C.GAME_WIDTH, C.GAME_HEIGHT, 0x140a20, 0.7).setScrollFactor(0).setDepth(C.DEPTH.modal).setAlpha(0);
    const head = this.add.text(cx, cy - 90, title, { ...style, fontSize: '48px', color: '#fff3c4', strokeThickness: 8 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.modal + 1).setScale(0.5);
    const text = this.add.text(cx, cy - 10, body, { ...style, fontSize: '19px', color: '#e8dccc', strokeThickness: 4, lineSpacing: 8 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.modal + 1).setAlpha(0);
    const button = this.add.text(cx, cy + 90, action, {
      ...style, fontSize: '26px', color: '#1a1020', backgroundColor: '#ffd23f', padding: { x: 28, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.modal + 1).setAlpha(0);

    this.tweens.add({ targets: dim, alpha: 1, duration: 300 });
    this.tweens.add({ targets: head, scale: 1, duration: 500, ease: 'Back.Out' });
    this.tweens.add({ targets: [text, button], alpha: 1, duration: 300, delay: 300 });
    this.tweens.add({ targets: button, scale: 1.06, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 600 });

    let used = false;
    const go = () => {
      if (used) return;
      used = true;
      this.input.keyboard?.off('keydown', onKey);
      sfx.pick();
      onAction();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.repeat && ['Space', 'Enter', 'KeyR'].includes(event.code)) go();
    };
    this.time.delayedCall(900, () => {
      button.setInteractive({ useHandCursor: true }).on('pointerdown', go);
      this.input.keyboard?.on('keydown', onKey);
    });
  }
}
