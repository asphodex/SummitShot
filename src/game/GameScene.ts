import Phaser from 'phaser';
import * as C from './constants';
import { showChoice } from './choice';
import {
  ENEMY_DEFS,
  initialState,
  isHidden,
  isShielded,
  thinkEnemy,
  type Enemy,
  type EnemyWorld,
} from './enemies';
import { isDawn, nightness, phaseHint, phaseOf, skyColor, strengthFor, type DayPhase } from './daycycle';
import { Hud } from './hud';
import { TUNING } from './tuning';
import { isTouchDevice, openTouchEditor, TouchControls } from './touch';
import { Tutorial } from './tutorial';
import { BEAM_HALF_THICKNESS, generateLayout, type Arena, type Layout } from './level';
import { getSeason, planLevel, type EnemyKind, type LevelPlan } from './season';
import { sfx } from './sfx';
import {
  DAMAGE_FONT_CHARS,
  biomeKey,
  createBiomeTextures,
  createCommonTextures,
  createDamageFont,
  enemyTint,
  toColor,
} from './textures';
import {
  ABILITIES,
  UPGRADES,
  clearRun,
  enemyHpMultiplier,
  loadRun,
  markTutorialDone,
  newRun,
  rollChoices,
  saveRun,
  type AbilityId,
  type RunState,
} from './upgrades';
import { RENDER_SCALE, setupView, viewHeight, viewWidth, WORLD_ZOOM } from './view';

type Mode = 'play' | 'choice' | 'exit' | 'dead' | 'pause' | 'ending';
type KeyName = 'up' | 'down' | 'left' | 'right' | 'up2' | 'down2' | 'left2' | 'right2' | 'fire' | 'roll' | 'crouch' | 'crouch2';
type Img = Phaser.GameObjects.Image;

interface Obstacle { x: number; y: number; r: number }
interface Beam { x1: number; x2: number; y: number }
interface Pool { x: number; y: number; rx: number; ry: number }

interface Arrow {
  x: number; y: number; vx: number; vy: number;
  life: number; damage: number; pierce: number; bounces: number;
  hits: Enemy[]; stuck: number; sprite: Img; shadow: Img;
  /** Выпущена кликом мыши (нужно обучению). */
  mouse: boolean;
}

interface Shot {
  x: number; y: number; vx: number; vy: number;
  high: boolean; damage: number; life: number; sprite: Img; shadow: Img;
  /** Уже засчитан как уклонение (для статистики). */
  dodged: boolean;
}

interface Orb {
  x: number; y: number; vx: number; vy: number; z: number; vz: number;
  value: number; age: number; sprite: Img; shadow: Img;
}

interface Blast { x: number; y: number; r: number; timer: number; delay: number; ring: Img; fill: Img; power: number }

interface Player {
  x: number; y: number; vx: number; vy: number;
  stamina: number; staminaDelay: number; invuln: number;
  fireCooldown: number; volley: number;
  burstLeft: number; burstTimer: number; burstAngle: number;
  crouch: boolean; crouchK: number;
  roll: number; rollDx: number; rollDy: number; rollHits: Set<Enemy>;
  aim: number; squash: number; walk: number; dustTimer: number;
  sprite: Img; shadow: Img; bow: Img;
  // Активная броня и пассивки.
  orbitAngle: number; orbitSprites: Img[];
  // Анимация лука: угол на экране, отдача после выстрела, натяжение и стрела на тетиве.
  bowAngle: number; bowKick: number; bowDraw: number; nocked: Img;
  shieldReady: boolean; shieldTimer: number; shieldRing: Img;
  lightningTimer: number; secondWindUsed: boolean;
}

/** Как враг получил урон — от этого зависят эффекты. */
type HitSource = 'arrow' | 'poison' | 'other';

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
  private fog!: Img;
  private vignette!: Img;
  private arrowTrail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hitstop = 0;
  private hurtFlash = 0;
  private pickupStreak = 0;
  private pickupStreakTimer = 0;
  private pendingUpgrades = 0;
  private pendingAbility = false;
  private exitTimer = 0;
  private exitStarted = false;
  private lastShotSfx = 0;
  private lastShotByMouse = false;
  /** Клик мышью, который ещё не превратился в выстрел. */
  private mouseShotQueued = false;
  /** Сценарий обучения — только на уровне 0. */
  private tutorial: Tutorial | null = null;
  /** Сенсорное управление (только на телефонах и планшетах): джойстик, рывок, присед, автострельба. */
  private touch: TouchControls | null = null;
  /**
   * Камера интерфейса — только на телефоне: мир там увеличен (WORLD_ZOOM), а интерфейс
   * (всё со scrollFactor 0) остаётся в прежнем масштабе, чтобы меню и баннеры помещались на экран.
   */
  private uiCam: Phaser.Cameras.Scene2D.Camera | null = null;
  private levelTime = 0;
  /** Самая высокая точка, до которой игрок поднялся на этом уровне (в пикселях от старта). */
  private levelClimb = 0;
  /** Лазерные прицелы снайперов. */
  private aimLines!: Phaser.GameObjects.Graphics;
  /** Объекты меню паузы (null — пауза закрыта). */
  private pauseParts: Phaser.GameObjects.GameObject[] | null = null;
  /** Смена суток: текущая фаза, заливка неба и подпись в HUD. */
  private dayPhase: DayPhase = 'day';
  private sky!: Phaser.GameObjects.Rectangle;
  private phaseText!: Phaser.GameObjects.Text;
  /** Враг, который сейчас "думает" — его выстрелы и взрывы получают его силу. */
  private shooter: Enemy | null = null;
  /** Когда каждый враг в последний раз получил урон от орбиты / шипов (время уровня). */
  private orbitHitAt = new Map<Enemy, number>();
  private thornsHitAt = new Map<Enemy, number>();
  /** Время уровня, когда началась битва с боссом. */
  private bossStartTime = 0;
  /** Счётчик FPS (клавиша F) — чтобы проверять производительность на своём ПК. */
  private fpsText: Phaser.GameObjects.Text | null = null;
  /** Пул всплывающих цифр урона. */
  private popPool: Phaser.GameObjects.BitmapText[] = [];
  private popActive = 0;
  /** Неподвижный декор уровня — прячем всё, что вне экрана. */
  private decor: { obj: Phaser.GameObjects.Components.Visible; y: number }[] = [];
  private lastCullY = Number.NaN;
  /** Вертолёт финальной катсцены. */
  private heli: { body: Img; rotor: Img; shadow: Img; ladder: Phaser.GameObjects.Graphics; chop: number } | null = null;

  constructor() {
    super('GameScene');
  }

  init(data: { run?: RunState }): void {
    this.run = data.run ?? newRun(0);
  }

  create(): void {
    setupView(this);
    this.setupWorldZoom();
    this.resetState();
    const run = this.run;
    this.plan = planLevel(run.season, run.level, run.seed);
    this.layout = generateLayout(this.plan);
    this.arena = this.layout.arena;

    createCommonTextures(this);
    createDamageFont(this);
    createBiomeTextures(this, this.plan.biome, this.plan.biomeIndex);
    if (run.xpNeeded <= 0) run.xpNeeded = this.computeXpNeeded();
    saveRun(run);

    const cam = this.cameras.main;
    this.fitCamera();
    cam.setBackgroundColor(this.plan.biome.groundDark);

    this.buildWorld();
    this.createPlayer();
    this.createEffects();
    this.createWorldApi();
    this.setupInput();
    this.touch = isTouchDevice() ? new TouchControls(this, () => this.togglePause()) : null;
    this.hud = new Hud(this, this.plan.biome.name, run.level);
    if (this.plan.isTutorial) this.startTutorial();

    cam.scrollY = this.plan.length - this.worldViewH() + this.cameraDrop();
    cam.fadeIn(450, 20, 10, 30);
    this.uiCam?.fadeIn(450, 20, 10, 30);
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
    this.levelClimb = 0;
    this.pauseParts = null;
    this.orbitHitAt.clear();
    this.thornsHitAt.clear();
    this.bossStartTime = 0;
    this.heli = null;
    this.tutorial = null;
    this.mouseShotQueued = false;
    this.shooter = null;
    this.popPool = [];
    this.fpsText = null;
    this.popActive = 0;
    this.decor = [];
    this.lastCullY = Number.NaN;
    this.endTarget = null;
    this.climbing = false;
    this.ladderLength = 0;
  }

  /**
   * Сколько опыта нужно до следующего усиления: весь опыт врагов этого уровня
   * × levelsPerUpgrade из конфига (≈ одно усиление на 1.15 уровня, если зачищать всё).
   */
  private computeXpNeeded(): number {
    const spawnXp = this.layout.spawns.reduce((sum, s) => sum + ENEMY_DEFS[s.kind].xp, 0);
    const perLevel = Math.max(25, spawnXp + (this.plan.isBoss ? 60 : 0));
    return Math.round(perLevel * TUNING.progression.levelsPerUpgrade);
  }

  // ===========================================================================
  // Построение уровня
  // ===========================================================================

  private buildWorld(): void {
    const b = this.plan.biome;
    const L = this.plan.length;

    // На телефоне земля продолжается ниже края уровня — туда может заглянуть камера (см. cameraDrop).
    const groundH = L + (isTouchDevice() ? C.TOUCH_WORLD_BOTTOM_PAD : 0);
    this.add.tileSprite(-C.SIDE_EXTRA, 0, C.GAME_WIDTH + C.SIDE_EXTRA * 2, groundH, biomeKey(b, 'ground'))
      .setOrigin(0).setDepth(C.DEPTH.ground).setTileScale(1 / RENDER_SCALE);

    for (const d of this.layout.decals) {
      this.keepDecor(this.add.image(d.x, d.y, biomeKey(b, `decal${d.variant}`)).setDepth(C.DEPTH.decal).setAlpha(0.85), d.y);
    }

    for (const p of this.layout.pools) {
      const img = this.keepDecor(this.add.image(p.x, p.y, biomeKey(b, 'pool')).setDepth(C.DEPTH.pool), p.y);
      img.setScale((p.rx * 2) / 160, (p.ry * 2) / 88);
      if (b.poolHurts) {
        this.tweens.add({ targets: img, alpha: 0.75, duration: 700 + Math.random() * 400, yoyo: true, repeat: -1 });
      }
      this.pools.push(p);
    }

    this.buildCliffs();

    for (const o of this.layout.obstacles) {
      const key = o.kind === 'tree' ? biomeKey(b, 'tree') : biomeKey(b, `rock${o.variant}`);
      const img = this.keepDecor(this.add.image(o.x, o.y, key).setScale(o.scale).setDepth(C.DEPTH.world + o.y), o.y);
      img.setOrigin(0.5, o.kind === 'tree' ? 0.94 : 0.6);
      this.keepDecor(this.add.image(o.x + 4, o.y + 3, 'shadow').setScale((o.r * 2.6) / 64).setDepth(C.DEPTH.shadow), o.y);
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
    this.fog = this.add.image(0, 0, 'fog').setOrigin(0)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay).setTint(toColor(b.fog)).setAlpha(C.FOG_ALPHA);
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay + 1);
    this.hurtOverlay = this.add.image(0, 0, 'hurt').setOrigin(0)
      .setScrollFactor(0).setDepth(C.DEPTH.overlay + 2).setAlpha(0);
    // Заливка умножается на картинку: к ночи всё темнеет и синеет, а не сереет.
    this.sky = this.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0)
      // Выше тумана: ночью затемняется и он, иначе верх экрана выглядит засвеченным.
      .setScrollFactor(0).setDepth(C.DEPTH.overlay + 0.5).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.phaseText = this.add.text(0, 56, '', {
      fontFamily: C.FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffe8c0', stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(C.DEPTH.hud + 1);
    this.fitOverlays();
    this.updateDayCycle(true);
  }

  /**
   * Смена суток по мере подъёма: экран темнеет, тёплые враги слабеют, ледяные крепнут.
   * Считается весь подъём за забег, на текущем уровне — только самая высокая точка.
   */
  private updateDayCycle(initial = false): void {
    // При первом вызове игрока ещё нет (мир строится раньше), а подъём на уровне — 0.
    // Старт игрока — plan.length - 130 (см. createPlayer).
    if (!initial) this.levelClimb = Math.max(this.levelClimb, this.plan.length - 130 - this.player.y);
    const climb = this.totalClimb();
    const night = this.plan.isTutorial ? 0 : nightness(climb);
    this.sky.setFillStyle(skyColor(night), 1);
    // Ночью туман редеет — светлая дымка в темноте выглядела бы засветом.
    this.fog.setAlpha(C.FOG_ALPHA * (1 - night * 0.6));

    const phase = phaseOf(night);
    if (phase === this.dayPhase && !initial) return;
    this.dayPhase = phase;
    const dawn = isDawn(climb);
    this.phaseText.setText(phaseHint(phase, dawn));
    if (initial) return;
    sfx.gateOpen();
  }

  private totalClimb(): number {
    return this.run.stats.climb + this.levelClimb;
  }

  /** Сила врага в текущей фазе суток: <1 — ослаблен, >1 — усилен. */
  private strengthOf(e: Enemy): number {
    const temp = e.kind === 'boss' ? this.plan.biome.boss.temp : ENEMY_DEFS[e.kind].temp;
    return strengthFor(temp, this.dayPhase);
  }

  private shooterStrength(): number {
    return this.shooter ? this.strengthOf(this.shooter) : 1;
  }

  /** Камера по центру поля; на широком экране видно больше скал по бокам. */
  private fitCamera(): void {
    // Без setBounds: при зуме камеры Phaser считает границы от центра, а у нас начало координат в углу.
    this.cameras.main.scrollX = this.cameraTargetX();
  }

  /** Поле уже экрана (телефон с зумом) — камера идёт за героем по горизонтали, иначе стоит по центру. */
  private cameraTargetX(): number {
    const w = this.worldViewW();
    if (w >= C.GAME_WIDTH || !this.player) return (C.GAME_WIDTH - w) / 2;
    return Phaser.Math.Clamp(this.player.x - w / 2, 0, C.GAME_WIDTH - w);
  }

  /**
   * На телефоне камера может опуститься ниже края уровня: тогда герой на старте
   * (plan.length - 130) стоит на высоте TOUCH_CAMERA_ANCHOR, а не внизу под джойстиком.
   */
  private cameraDrop(): number {
    if (!this.touch) return 0;
    return Phaser.Math.Clamp(this.worldViewH() * (1 - C.TOUCH_CAMERA_ANCHOR) - 130, 0, C.TOUCH_WORLD_BOTTOM_PAD);
  }

  /** Видимая часть мира (на телефоне меньше экрана интерфейса в WORLD_ZOOM раз). */
  private worldViewW(): number {
    return viewWidth(this) / WORLD_ZOOM;
  }

  private worldViewH(): number {
    return viewHeight(this) / WORLD_ZOOM;
  }

  private setupWorldZoom(): void {
    this.uiCam = null;
    if (WORLD_ZOOM === 1) return;
    this.cameras.main.setZoom(RENDER_SCALE * WORLD_ZOOM);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'ui').setOrigin(0, 0).setZoom(RENDER_SCALE);
  }

  /** Каждый объект рисует одна камера: интерфейс (scrollFactor 0) — камера интерфейса, остальное — мир. */
  private assignCameras(): void {
    const ui = this.uiCam;
    if (!ui) return;
    const worldId = this.cameras.main.id;
    for (const obj of this.children.list) {
      const screenSpace = (obj as Partial<Phaser.GameObjects.Components.ScrollFactor>).scrollFactorX === 0;
      obj.cameraFilter = screenSpace ? worldId : ui.id;
    }
  }

  private fitOverlays(): void {
    const width = viewWidth(this);
    const height = viewHeight(this);
    this.fog.setDisplaySize(width, 170);
    this.vignette.setDisplaySize(width, height);
    this.hurtOverlay.setDisplaySize(width, height);
    this.sky?.setSize(width, height);
    this.phaseText?.setX(width - 16);
    this.fpsText?.setPosition(width - 16, 82);
  }

  /** Окно изменило размер: подгоняем камеру и экранные слои. */
  private onResize(): void {
    this.uiCam?.setSize(this.scale.width, this.scale.height);
    this.fitCamera();
    this.fitOverlays();
    this.lastCullY = Number.NaN;
  }

  private toggleFps(): void {
    if (this.fpsText) {
      this.fpsText.destroy();
      this.fpsText = null;
      return;
    }
    this.fpsText = this.add.text(viewWidth(this) - 16, 82, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#9cffd6', backgroundColor: '#1a1020', padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(C.DEPTH.modal + 5);
  }

  private updateFps(): void {
    if (!this.fpsText || this.game.loop.frame % 15 !== 0) return;
    const drawn = this.children.list.filter((o) => (o as Partial<Phaser.GameObjects.Components.Visible>).visible !== false).length;
    const renderer = this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
    this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} FPS · ${renderer} · ${drawn}/${this.children.list.length} obj`);
  }

  /** Запоминает неподвижный объект, чтобы прятать его, когда он за экраном. */
  private keepDecor<T extends Phaser.GameObjects.Components.Visible>(obj: T, y: number): T {
    this.decor.push({ obj, y });
    return obj;
  }

  private isOnScreen(y: number): boolean {
    const top = this.cameras.main.scrollY - C.CULL_MARGIN;
    return y > top && y < top + this.worldViewH() + C.CULL_MARGIN * 2;
  }

  /**
   * Отсечение: рисуем только то, что рядом с экраном. На длинных уровнях
   * так отрисовывается ~200 объектов вместо ~600. Пересчёт — только когда камера сдвинулась.
   */
  private cullDecor(): void {
    const scrollY = this.cameras.main.scrollY;
    if (Math.abs(scrollY - this.lastCullY) < 16) return;
    this.lastCullY = scrollY;
    for (const d of this.decor) d.obj.setVisible(this.isOnScreen(d.y));
  }

  private buildCliffs(): void {
    const b = this.plan.biome;
    const L = this.plan.length;
    const dark = toColor(b.cliffDark);
    this.add.rectangle(-C.SIDE_EXTRA, 0, C.SIDE_EXTRA + C.SIDE_WALL, L, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    this.add.rectangle(C.GAME_WIDTH - C.SIDE_WALL, 0, C.SIDE_EXTRA + C.SIDE_WALL, L, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    const rng = this.plan.rng;
    for (let y = -40; y < L + 80; y += 62) {
      for (const side of [0, 1]) {
        const x = side === 0 ? rng.between(-20, 20) : C.GAME_WIDTH - rng.between(-20, 20);
        const yy = y + rng.between(-14, 14);
        this.keepDecor(this.add.image(x, yy, biomeKey(b, 'cliff'))
          .setOrigin(0.5, 0.7)
          .setScale(rng.realInRange(0.8, 1.1))
          .setFlipX(side === 1)
          .setDepth(C.DEPTH.world + yy + 40), yy);
      }
    }
    this.buildOuterCliffs(rng);
    if (isTouchDevice()) this.buildBottomCliffs();
  }

  /**
   * Скалы ниже края уровня — только на телефоне, куда опускается камера.
   * Свой генератор случайных чисел: раскладка самого уровня не меняется.
   */
  private buildBottomCliffs(): void {
    const b = this.plan.biome;
    const L = this.plan.length;
    const pad = C.TOUCH_WORLD_BOTTOM_PAD;
    const rng = new Phaser.Math.RandomDataGenerator([`${this.run.seed}:bottom`]);
    const dark = toColor(b.cliffDark);
    this.add.rectangle(-C.SIDE_EXTRA, L, C.SIDE_EXTRA + C.SIDE_WALL, pad, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    this.add.rectangle(C.GAME_WIDTH - C.SIDE_WALL, L, C.SIDE_EXTRA + C.SIDE_WALL, pad, dark).setOrigin(0).setDepth(C.DEPTH.decal);
    for (let y = L + 80; y < L + pad; y += 62) {
      for (const side of [0, 1]) {
        const x = side === 0 ? rng.between(-20, 20) : C.GAME_WIDTH - rng.between(-20, 20);
        const yy = y + rng.between(-14, 14);
        this.keepDecor(this.add.image(x, yy, biomeKey(b, 'cliff'))
          .setOrigin(0.5, 0.7)
          .setScale(rng.realInRange(0.8, 1.1))
          .setFlipX(side === 1)
          .setDepth(C.DEPTH.world + yy + 40), yy);
      }
    }
  }

  /**
   * Дальние скалы за краями поля — видны только на широких экранах.
   * Темнее и крупнее, чтобы читались как задний план, а не как препятствия.
   */
  private buildOuterCliffs(rng: Phaser.Math.RandomDataGenerator): void {
    const b = this.plan.biome;
    for (let y = -60; y < this.plan.length + 100; y += 84) {
      for (let col = 1; col * C.OUTER_CLIFF_STEP < C.SIDE_EXTRA; col++) {
        for (const side of [0, 1]) {
          const offset = col * C.OUTER_CLIFF_STEP + rng.between(-25, 25);
          const x = side === 0 ? -offset : C.GAME_WIDTH + offset;
          const yy = y + rng.between(-30, 30);
          const shade = Math.max(0x80, 0xd8 - col * 0x18);
          this.keepDecor(this.add.image(x, yy, biomeKey(b, 'cliff'))
            .setOrigin(0.5, 0.7)
            .setScale(rng.realInRange(1.1, 1.5))
            .setFlipX(rng.frac() < 0.5)
            .setTint(Phaser.Display.Color.GetColor(shade, shade, shade))
            .setDepth(C.DEPTH.world + yy + 40), yy);
        }
      }
    }
  }

  private buildBeam(beam: Beam): void {
    const width = beam.x2 - beam.x1;
    this.keepDecor(this.add.rectangle(beam.x1, beam.y + 4, width, 14, 0x000000, 0.18).setOrigin(0, 0.5).setDepth(C.DEPTH.shadow), beam.y);
    for (const x of [beam.x1 + 8, beam.x2 - 8]) {
      this.keepDecor(this.add.image(x, beam.y + 12, 'post').setOrigin(0.5, 0.9).setDepth(C.DEPTH.world + beam.y + 10), beam.y);
    }
    this.keepDecor(this.add.image(beam.x1, beam.y - 26, 'log').setOrigin(0, 0.5)
      .setDisplaySize(width, 30)
      .setDepth(C.DEPTH.world + beam.y + 30), beam.y);
    this.beams.push(beam);
  }

  private buildArena(arena: Arena): void {
    this.gate = this.add.tileSprite(C.SIDE_WALL, arena.gateY, C.GAME_WIDTH - C.SIDE_WALL * 2, 76, 'stake')
      .setOrigin(0, 0.85)
      .setTileScale(1 / RENDER_SCALE)
      .setDepth(C.DEPTH.world + arena.gateY);
    this.boss = this.createBoss(arena);
    if (this.isFinalLevel()) this.buildVolcanoCrater(arena);
  }

  private isFinalLevel(): boolean {
    return this.plan.level === C.LEVELS_PER_SEASON;
  }

  /** Финал: кратер вулкана — лавовые озёра по краям арены и дым с искрами. */
  private buildVolcanoCrater(arena: Arena): void {
    const b = this.plan.biome;
    for (const [x, y] of [[175, 330], [C.GAME_WIDTH - 175, 330]]) {
      const pool = { x, y, rx: 70, ry: 42 };
      const img = this.add.image(x, y, biomeKey(b, 'pool')).setDepth(C.DEPTH.pool).setScale(140 / 160, 84 / 88);
      if (b.poolHurts) this.tweens.add({ targets: img, alpha: 0.75, duration: 600, yoyo: true, repeat: -1 });
      this.pools.push(pool);
    }
    this.add.particles(0, 0, 'soft', {
      x: { min: C.SIDE_WALL, max: C.GAME_WIDTH - C.SIDE_WALL }, y: arena.bottom,
      lifespan: 3500, speedY: { min: -120, max: -50 }, speedX: { min: -20, max: 20 },
      scale: { start: 0.4, end: 0 }, tint: [0xffb03f, 0xff5a1f], blendMode: 'ADD', frequency: 50,
    }).setDepth(C.DEPTH.overlay - 6);
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
      orbitAngle: 0, orbitSprites: [],
      bowAngle: -Math.PI / 2, bowKick: 0, bowDraw: 0,
      nocked: this.add.image(x, y, 'arrow').setOrigin(0.85, 0.5).setVisible(false),
      shieldReady: this.run.shield > 0, shieldTimer: 0,
      shieldRing: this.add.image(x, y, 'ring').setTint(0x7fd8ff).setScale(0.5).setAlpha(0),
      lightningTimer: C.LIGHTNING_INTERVAL, secondWindUsed: false,
    };
  }

  private createEnemy(kind: EnemyKind, x: number, y: number, small = false): Enemy {
    const def = ENEMY_DEFS[kind];
    const d = this.plan.difficulty;
    const baseScale = small ? 0.6 : 0.9;
    const hp = Math.round(def.hp * enemyHpMultiplier(this.run) * (small ? 0.4 : 1));
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
      state: initialState(kind), timer: 0.4 + Math.random() * 1.2, aim: Math.random() * 10, alt: Math.random() < 0.5, bumped: false,
      hop: 0, flash: 0, squash: 0, wobble: Math.random() * 10, slow: 0, poison: 0, poisonTick: 0,
      boss: null,
    };
    e.sprite.setDepth(C.DEPTH.world + y);
    this.enemies.push(e);
    return e;
  }

  private createBoss(arena: Arena): Enemy {
    const b = this.plan.biome;
    // Босс подчиняется тому же правилу роста HP, что и обычные враги; финальный — крупнее.
    const final = this.isFinalLevel();
    const hp = Math.round(TUNING.enemies.bossBaseHp * enemyHpMultiplier(this.run) * (final ? TUNING.enemies.finalBossHpMul : 1) * this.bossHpBoost());
    const e = this.createEnemy(b.enemies[0], arena.bossX, arena.bossY);
    e.kind = 'boss';
    e.state = 'idle';
    e.sprite.setTexture(biomeKey(b, 'boss')).setOrigin(0.5, 0.75);
    e.baseScale = final ? 1 : 0.8;
    e.radius = final ? 68 : 56;
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

  /** Усиление HP босса: ×3 у первого босса и до ×5 у последнего (линейно по номеру босса). */
  private bossHpBoost(): number {
    const bosses = Math.floor(C.LEVELS_PER_SEASON / C.BOSS_EVERY);
    const index = Math.floor(this.plan.level / C.BOSS_EVERY) - 1;
    const t = bosses > 1 ? Phaser.Math.Clamp(index / (bosses - 1), 0, 1) : 1;
    return Phaser.Math.Linear(TUNING.enemies.bossHpBoostFirst, TUNING.enemies.bossHpBoostLast, t);
  }

  private startTutorial(): void {
    this.tutorial = new Tutorial({
      scene: this,
      playerX: () => this.player.x,
      playerY: () => this.player.y,
      spawnDummy: (x, y, hp) => {
        const e = this.createEnemy('dummy', x, y);
        e.awake = true;
        if (hp !== undefined) e.hp = e.maxHp = hp;
        this.puff(x, y, 0xffffff, 8);
        return e;
      },
      removeDummy: (e) => {
        e.dead = true;
        this.puff(e.x, e.y, 0xffffff, 8);
        e.sprite.destroy();
        e.shadow.destroy();
      },
      fireShot: (x, y, angle, speed) => this.fireShot(x, y, angle, speed, false),
      skip: () => this.skipTutorial(),
    }, this.touch !== null);
  }

  private skipTutorial(): void {
    if (!this.tutorial || this.mode !== 'play') return;
    this.finishLevel();
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
    this.aimLines = this.add.graphics().setDepth(C.DEPTH.overlay - 12);
    this.arrowTrail = this.add.particles(0, 0, 'soft', {
      lifespan: 160, speed: 0, scale: { start: 0.28, end: 0 }, alpha: { start: 0.55, end: 0 }, emitting: false,
    }).setDepth(C.DEPTH.overlay - 13);
    this.createAmbient();
  }

  private createAmbient(): void {
    const b = this.plan.biome;
    const W = viewWidth(this);
    const H = viewHeight(this);
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
      shake: (intensity, ms) => this.cameras.main.shake(ms, intensity * C.BOSS_SHAKE_MUL),
      roar: () => sfx.bossRoar(),
      detonate: (e) => {
        this.spawnBlast(e.x, e.y, 72, 0.01);
        this.killEnemy(e);
      },
      healAround: (healer, radius, fraction) => this.healAround(healer, radius, fraction),
    };
  }

  private healAround(healer: Enemy, radius: number, fraction: number): void {
    sfx.heal();
    const ring = this.add.image(healer.x, healer.y, 'ring').setTint(0x7fff9f).setScale(0.2).setDepth(C.DEPTH.pool + 1);
    this.tweens.add({ targets: ring, scale: (radius * 2) / 128, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
    for (const e of this.enemies) {
      if (e.dead || e === healer || e.hp >= e.maxHp) continue;
      if (Math.hypot(e.x - healer.x, e.y - healer.y) > radius) continue;
      const amount = Math.round(e.maxHp * fraction);
      e.hp = Math.min(e.maxHp, e.hp + amount);
      this.popText(e.x, e.y - 44, `+${amount}`, '#7fff9f', 16);
    }
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
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      sfx.unlock();
      // Запоминаем клик: даже очень короткое нажатие (между кадрами) даст выстрел.
      if (!this.touch && pointer.leftButtonDown()) this.mouseShotQueued = true;
    });

    kb.on('keydown-ESC', () => this.togglePause());
    kb.on('keydown-F', () => this.toggleFps());
    kb.on('keydown-ENTER', () => this.skipTutorial());
    kb.on('keydown-P', () => this.togglePause());
    // Окно потеряло фокус — ставим паузу, чтобы не умереть, пока игрок отошёл.
    const onBlur = () => {
      if (this.mode === 'play') this.openPause();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    const onResize = () => this.onResize();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
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
    } else if (this.mode === 'ending') {
      this.stepEnding(dt);
    }

    this.cullDecor();
    this.updateDayCycle();
    this.updateFps();
    this.assignCameras();
    this.updateHurtOverlay(dt);
    this.touch?.setActive(this.mode === 'play');
    this.touch?.update(dt);
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
    this.run.stats.time += dt;
    this.updatePlayer(dt);
    this.updateCamera(dt);
    this.updateShooting(dt);
    this.updateArrows(dt);
    this.updateArmor(dt);
    this.updateEnemies(dt);
    this.tutorial?.update(dt);
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
    if (len > 0) return { x: x / len, y: y / len };
    return this.touch ? this.touch.move() : { x: 0, y: 0 };
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const run = this.run;
    const move = this.moveInput();
    const pointer = this.input.activePointer;
    // Нажатие "Рывка" во время переката сбрасываем, чтобы не было запоздалого второго.
    const touchRoll = this.touch?.consumeRoll() ?? false;

    p.invuln -= dt;
    p.staminaDelay -= dt;

    if (p.roll > 0) {
      this.updateRoll(dt);
    } else {
      p.crouch = this.keys.crouch.isDown || this.keys.crouch2.isDown || pointer.rightButtonDown() || !!this.touch?.crouching;
      if (Phaser.Input.Keyboard.JustDown(this.keys.roll) || touchRoll) this.tryRoll(move.x, move.y);

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
    this.tutorial?.onRoll();
    p.staminaDelay = C.STAMINA_REGEN_DELAY;
    p.burstLeft = 0;
    this.run.stats.rolls += 1;
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
    // Внутри уровня можно ходить и назад; на арене босса — только внутри арены.
    const floor = this.arenaLocked && this.arena ? this.arena.bottom : this.plan.length;
    const bottom = floor - r - 6;
    if (p.y > bottom) {
      p.y = bottom;
      p.vy = Math.min(p.vy, 0);
    }
    if (this.gate && this.arena && this.boss && !this.boss.dead) {
      p.y = Math.max(p.y, this.arena.gateY + 20 + r);
    }
    if (this.tutorial) p.y = Math.max(p.y, this.tutorial.minPlayerY());
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

    this.syncBow(dt);
  }

  /**
   * Лук: быстро доворачивается к цели, натягивается к следующему выстрелу
   * и пружинит от отдачи — чтобы стрельба ощущалась резкой.
   */
  private syncBow(dt: number): void {
    const p = this.player;
    const turn = Phaser.Math.Angle.Wrap(p.aim - p.bowAngle);
    p.bowAngle += turn * Math.min(1, dt * C.BOW_TURN_SPEED);
    p.bowKick = Math.max(0, p.bowKick - dt * 7);

    const holding = this.wantsFire() && this.mode === 'play';
    const interval = C.FIRE_INTERVAL / this.run.fireRateMul;
    const targetDraw = holding ? Phaser.Math.Clamp(1 - p.fireCooldown / interval, 0, 1) : 0;
    p.bowDraw += (targetDraw - p.bowDraw) * Math.min(1, dt * 18);

    // Отдача: лук отскакивает назад и "вздрагивает" плечами (затухающая волна).
    const wobble = Math.sin(p.bowKick * 18) * p.bowKick;
    const dist = C.BOW_DISTANCE - p.bowKick * C.BOW_KICK_BACK - p.bowDraw * 3;
    const cos = Math.cos(p.bowAngle);
    const sin = Math.sin(p.bowAngle);
    const bx = p.x + cos * dist;
    const by = p.y - C.BOW_CHEST_HEIGHT + p.crouchK * 8 + sin * dist;
    const visible = p.roll <= 0;
    p.bow
      .setVisible(visible)
      .setPosition(bx, by)
      .setRotation(p.bowAngle)
      .setScale(1 + p.bowDraw * 0.12 - p.bowKick * 0.15, 1 - p.bowDraw * 0.18 + wobble * 0.35)
      .setDepth(C.DEPTH.world + p.y + 1);

    // Стрела на тетиве: появляется при натяжении и отъезжает назад вместе с ним.
    const showNocked = visible && p.bowDraw > 0.25 && p.bowKick < 0.4;
    p.nocked
      .setVisible(showNocked)
      .setPosition(bx + cos * (14 - p.bowDraw * 8), by + sin * (14 - p.bowDraw * 8))
      .setRotation(p.bowAngle)
      .setAlpha(Math.min(1, (p.bowDraw - 0.25) * 3))
      .setDepth(C.DEPTH.world + p.y + 2);
  }

  /** Куда смотрит лук между выстрелами: на ближайшего врага, иначе — по ходу движения. */
  private updateIdleAim(): void {
    const p = this.player;
    if (!this.touch && this.input.activePointer.leftButtonDown()) return;
    const target = this.nearestEnemy(p.x, p.y, C.AUTO_AIM_RANGE, []);
    if (target) p.aim = Math.atan2(target.y - p.y, target.x - p.x);
    else if (Math.hypot(p.vx, p.vy) > 60) p.aim = Math.atan2(p.vy, p.vx);
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    cam.scrollX += (this.cameraTargetX() - cam.scrollX) * Math.min(1, dt * 8);
    const viewH = this.worldViewH();
    const anchor = this.touch ? C.TOUCH_CAMERA_ANCHOR : C.CAMERA_ANCHOR;
    if (this.arenaLocked && this.arena) {
      // Арена целиком в кадре; если экран ниже арены (телефон) — камера ходит за героем внутри неё.
      const lowest = Math.max(this.arena.top, this.arena.bottom - viewH + this.cameraDrop());
      const arenaTarget = Phaser.Math.Clamp(this.player.y - viewH * anchor, this.arena.top, lowest);
      cam.scrollY += (arenaTarget - cam.scrollY) * Math.min(1, dt * 4);
      return;
    }
    const target = Phaser.Math.Clamp(this.player.y - viewH * anchor, 0, this.plan.length - viewH + this.cameraDrop());
    cam.scrollY += (target - cam.scrollY) * Math.min(1, dt * 8);
  }

  private hurtPlayer(amount: number, fromX?: number, fromY?: number): void {
    const p = this.player;
    if (p.roll > 0 || p.invuln > 0 || this.mode !== 'play') return;
    if (this.tryShieldBlock()) return;
    // В обучении попадания только показываются — здоровье не тратится.
    const dmg = this.tutorial ? 0 : Math.round(amount * (this.has('shelter') && p.crouch ? C.SHELTER_DAMAGE_MUL : 1));
    this.run.hp -= dmg;
    this.run.stats.damageTaken += dmg;
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
    if (dmg > 0) this.popText(p.x, p.y - 44, `-${dmg}`, '#ff4f5f', 22);
    if (this.run.hp <= 0 && !this.trySecondWind()) this.die();
  }

  /** "Второе дыхание": раз за уровень вместо смерти восстанавливает часть здоровья. */
  private trySecondWind(): boolean {
    const p = this.player;
    if (!this.has('secondWind') || p.secondWindUsed) return false;
    p.secondWindUsed = true;
    this.run.hp = Math.round(this.run.maxHp * C.SECOND_WIND_HEAL);
    p.invuln = 2;
    sfx.levelUp();
    this.cameras.main.flash(250, 255, 220, 160);
    this.sparks.particleTint = 0xffd0a0;
    this.sparks.explode(24, p.x, p.y - 20);
    this.popText(p.x, p.y - 60, '❦', '#ffd0a0', 30);
    return true;
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

    if (p.burstLeft <= 0) this.updateIdleAim();

    const mouse = this.mouseFireAllowed() && (this.input.activePointer.leftButtonDown() || this.mouseShotQueued);
    if (!this.wantsFire() || p.roll > 0 || p.fireCooldown > 0) return;
    this.mouseShotQueued = false;

    sfx.unlock();
    p.fireCooldown = C.FIRE_INTERVAL / this.run.fireRateMul;
    this.lastShotByMouse = mouse;
    const angle = this.aimAngle(this.lastShotByMouse);
    p.aim = angle;
    p.volley += 1;
    this.fireSet(angle);
    p.burstLeft = this.run.burst - 1;
    p.burstTimer = C.BURST_DELAY;
    p.burstAngle = angle;
    if (this.run.ring && p.volley % C.RING_EVERY_VOLLEYS === 0) this.fireRing(C.RING_DAMAGE_MUL);
    p.squash = -0.1;
  }

  /** Хочет ли игрок стрелять: пробел или ЛКМ; на телефоне — сам, когда рядом есть враг. */
  private wantsFire(): boolean {
    if (this.touch) return this.nearestEnemy(this.player.x, this.player.y, C.AUTO_AIM_RANGE, []) !== null;
    if (!this.mouseFireAllowed()) {
      this.mouseShotQueued = false;
      return this.keys.fire.isDown;
    }
    return this.keys.fire.isDown || this.input.activePointer.leftButtonDown() || this.mouseShotQueued;
  }

  /** Мышью не стреляем на телефоне и на шаге обучения, где учат пробел. */
  private mouseFireAllowed(): boolean {
    return !this.touch && (this.tutorial?.allowsMouseFire() ?? true);
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
      if (e.dead || !e.awake || isHidden(e) || exclude.includes(e)) continue;
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
    // Стрелы вылетают с кончика лука, а не из центра героя.
    const tipX = p.x + Math.cos(angle) * C.BOW_DISTANCE;
    const tipY = p.y + Math.sin(angle) * C.BOW_DISTANCE;
    for (const a of angles) this.spawnArrow(tipX, tipY, a, 1);
    p.aim = angle;
    p.bowAngle = angle;
    p.bowKick = 1;
    p.bowDraw = 0;
    this.muzzleFlash(tipX, p.y - C.BOW_CHEST_HEIGHT + Math.sin(angle) * C.BOW_DISTANCE, angle);
    sfx.shoot();
  }

  /** Короткая вспышка и искры на кончике лука в момент выстрела. */
  private muzzleFlash(x: number, y: number, angle: number): void {
    const flash = this.add.image(x, y, 'soft').setTint(0xfff3c4).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.5, 0.3).setRotation(angle).setDepth(C.DEPTH.overlay - 10);
    this.tweens.add({ targets: flash, scaleX: 1.6, scaleY: 0.5, alpha: 0, duration: 110, ease: 'Quad.Out', onComplete: () => flash.destroy() });
    this.sparks.particleTint = 0xfff0c0;
    this.sparks.emitParticleAt(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6, 2);
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
    this.run.stats.arrows += 1;
    this.arrows.push({
      x, y,
      vx: Math.cos(angle) * C.ARROW_SPEED,
      vy: Math.sin(angle) * C.ARROW_SPEED,
      life: C.ARROW_LIFETIME,
      damage: C.ARROW_DAMAGE * this.run.damageMul * damageMul,
      pierce: this.has('pierce') ? 1 : 0,
      bounces: this.has('ricochet') ? 1 : 0,
      hits: [], stuck: 0, sprite, shadow, mouse: this.lastShotByMouse,
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

      const offscreen = a.y < cam.scrollY - 40 || a.y > cam.scrollY + this.worldViewH() + 40 || a.x < 0 || a.x > C.GAME_WIDTH;
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
        if (e.dead || a.hits.includes(e) || isHidden(e) || (e.kind === 'boss' && !e.awake)) continue;
        if (Math.hypot(e.x - a.x, e.y - a.y) > e.radius + C.ARROW_RADIUS) continue;
        if (isShielded(e) || (e.kind === 'dummy' && this.tutorial && !this.tutorial.canHitDummy(a.mouse))) {
          this.deflectArrow(a, e);
          break;
        }
        a.hits.push(e);
        const speed = Math.hypot(a.vx, a.vy);
        this.run.stats.hits += 1;
        if (this.has('frostArrows')) e.slow = Math.max(e.slow, C.FROST_ARROW_SLOW_TIME);
        this.hitEnemy(e, a.damage, a.vx / speed, a.vy / speed, 'arrow');
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

      // Первые доли секунды стрела вытянута — так читается скорость; плюс короткий след.
      const fresh = Math.max(0, a.life - (C.ARROW_LIFETIME - C.ARROW_STRETCH_TIME)) / C.ARROW_STRETCH_TIME;
      a.sprite.setPosition(a.x, a.y - ARROW_HEIGHT).setScale(1 + fresh * 0.9, 1 - fresh * 0.2).setDepth(C.DEPTH.world + a.y);
      if (this.game.loop.frame % 2 === 0) this.arrowTrail.emitParticleAt(a.x, a.y - ARROW_HEIGHT, 1);
      a.shadow.setPosition(a.x, a.y);
    }
    this.arrows = this.arrows.filter((a) => {
      if (a.life > 0 || a.stuck > 0) return true;
      a.sprite.destroy();
      a.shadow.destroy();
      return false;
    });
  }

  /** Стрела отскакивает от панциря и падает. */
  private deflectArrow(a: Arrow, e: Enemy): void {
    a.life = 0;
    e.squash = 0.12;
    sfx.block();
    this.sparks.particleTint = 0xd8e2ea;
    this.sparks.explode(5, a.x, a.y - ARROW_HEIGHT);
    if (Math.random() < 0.3) this.popText(e.x, e.y - 40, 'x', '#d8e2ea', 16);
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
  // Активная броня и пассивки
  // ===========================================================================

  private updateArmor(dt: number): void {
    const run = this.run;
    if (run.regen > 0 && run.hp < run.maxHp) run.hp = Math.min(run.maxHp, run.hp + run.regen * dt);
    this.updateOrbit(dt);
    this.updateShield(dt);
    if (this.has('lightning')) this.updateLightning(dt);
  }

  /** Стрелы-спутники: кружат вокруг героя, ранят врагов и сбивают вражеские снаряды. */
  private updateOrbit(dt: number): void {
    const p = this.player;
    const n = this.run.orbit;
    while (p.orbitSprites.length < n) p.orbitSprites.push(this.add.image(p.x, p.y, 'arrow').setOrigin(0.5));
    if (n === 0) return;

    p.orbitAngle += C.ORBIT_SPEED * dt;
    p.orbitSprites.forEach((sprite, i) => {
      const a = p.orbitAngle + (i / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * C.ORBIT_RADIUS;
      const y = p.y + Math.sin(a) * C.ORBIT_RADIUS * 0.75;
      sprite.setPosition(x, y - ARROW_HEIGHT).setRotation(a + Math.PI / 2).setDepth(C.DEPTH.world + y);

      for (const e of this.enemies) {
        if (e.dead || !e.awake || isHidden(e) || isShielded(e)) continue;
        if (Math.hypot(e.x - x, e.y - y) > e.radius + 8) continue;
        if (this.levelTime - (this.orbitHitAt.get(e) ?? -99) < C.ORBIT_HIT_COOLDOWN) continue;
        this.orbitHitAt.set(e, this.levelTime);
        this.hitEnemy(e, C.ORBIT_DAMAGE * this.run.damageMul, Math.cos(a), Math.sin(a));
      }
      for (const s of this.shots) {
        if (s.high || s.life <= 0 || Math.hypot(s.x - x, s.y - y) > 16) continue;
        s.life = 0;
        this.run.stats.dodges += 1;
        this.sparks.particleTint = 0xffe07f;
        this.sparks.explode(4, s.x, s.y - 8);
      }
    });
  }

  private shieldCooldown(): number {
    return C.SHIELD_COOLDOWNS[Math.min(this.run.shield, C.SHIELD_COOLDOWNS.length) - 1];
  }

  private updateShield(dt: number): void {
    const p = this.player;
    if (this.run.shield <= 0) return;
    if (!p.shieldReady) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) {
        p.shieldReady = true;
        sfx.select();
      }
    }
    const pulse = 0.35 + Math.sin(this.time.now / 200) * 0.1;
    p.shieldRing
      .setPosition(p.x, p.y - 18)
      .setAlpha(p.shieldReady ? pulse : 0)
      .setScale(0.42, 0.42)
      .setDepth(C.DEPTH.world + p.y + 2);
  }

  /** Щит поглощает удар. Возвращает true, если удар заблокирован. */
  private tryShieldBlock(): boolean {
    const p = this.player;
    if (!p.shieldReady) return false;
    p.shieldReady = false;
    p.shieldTimer = this.shieldCooldown();
    p.invuln = 0.5;
    sfx.block();
    this.sparks.particleTint = 0x7fd8ff;
    this.sparks.explode(14, p.x, p.y - 18);
    const ring = this.add.image(p.x, p.y - 18, 'ring').setTint(0x7fd8ff).setScale(0.42).setDepth(C.DEPTH.overlay - 12);
    this.tweens.add({ targets: ring, scale: 1.4, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
    return true;
  }

  private updateLightning(dt: number): void {
    const p = this.player;
    p.lightningTimer -= dt;
    if (p.lightningTimer > 0) return;
    const target = this.nearestEnemy(p.x, p.y, C.LIGHTNING_RANGE, []);
    if (!target) return;
    p.lightningTimer = C.LIGHTNING_INTERVAL;
    this.drawLightning(p.x, p.y - 30, target.x, target.y - 16);
    sfx.zap();
    this.hitEnemy(target, C.LIGHTNING_DAMAGE * this.run.damageMul, 0, 0);
  }

  private drawLightning(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.add.graphics().setDepth(C.DEPTH.overlay - 9);
    const segments = 7;
    g.lineStyle(4, 0xfff07f, 1).beginPath().moveTo(x1, y1);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      g.lineTo(x1 + (x2 - x1) * t + Phaser.Math.Between(-14, 14), y1 + (y2 - y1) * t + Phaser.Math.Between(-14, 14));
    }
    g.lineTo(x2, y2).strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.sparks.particleTint = 0xfff07f;
    this.sparks.explode(8, x2, y2);
  }

  private explode(x: number, y: number): void {
    const ring = this.add.image(x, y, 'ring').setTint(0xff8a3f).setScale(0.2).setDepth(C.DEPTH.overlay - 12);
    this.tweens.add({ targets: ring, scale: (C.EXPLOSION_RADIUS * 2) / 128, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
    this.chunks.particleTint = 0xff8a3f;
    this.chunks.explode(10, x, y - 10);
    for (const e of [...this.enemies]) {
      if (e.dead || isHidden(e) || Math.hypot(e.x - x, e.y - y) > C.EXPLOSION_RADIUS) continue;
      this.hitEnemy(e, C.EXPLOSION_DAMAGE * this.run.damageMul, e.x - x, e.y - y);
    }
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
    this.aimLines.clear();

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (!e.awake) {
        if (e.kind !== 'boss' && this.levelTime > C.START_GRACE && e.y > cam.scrollY + C.WAKE_INSET && e.y < cam.scrollY + this.worldViewH()) this.wake(e);
        // Спящий враг за экраном: просто прячем, без анимации.
        if (!e.awake && !this.isOnScreen(e.y)) {
          e.sprite.setVisible(false);
          e.shadow.setVisible(false);
          continue;
        }
        this.syncEnemy(e, dt);
        continue;
      }

      const mul = e.slow > 0 ? C.FROST_SLOW_MUL : 1;
      e.slow -= dt;
      this.updatePoison(e, dt);
      if (e.dead) continue;

      e.bumped = false;
      const power = this.strengthOf(e);
      this.shooter = e;
      thinkEnemy(e, this.world, dt * mul);
      this.shooter = null;
      e.x += (e.vx * mul * power + e.kx) * dt;
      e.y += (e.vy * mul * power + e.ky) * dt;
      const damp = Math.max(0, 1 - dt * 10);
      e.kx *= damp;
      e.ky *= damp;
      this.collideEnemy(e);

      if (e.kind === 'sniper' && e.state === 'aim') this.drawAimLine(e);

      const reach = e.radius + pr - 4;
      const canBite = e.damage > 0 && e.hop < 8 && !isHidden(e);
      if (canBite && Math.abs(e.x - p.x) < reach && Math.abs(e.y - p.y) < reach && Math.hypot(e.x - p.x, e.y - p.y) < reach) {
        this.applyThorns(e);
        this.hurtPlayer(e.damage * power, e.x, e.y);
      }
      this.syncEnemy(e, dt);
    }

    this.separateEnemies();
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /** Красный лазер снайпера: тонкий, пока целится, и толстый перед выстрелом. */
  private drawAimLine(e: Enemy): void {
    const locked = e.timer <= 0.35;
    const len = 900;
    this.aimLines
      .lineStyle(locked ? 3 : 1.5, 0xff3f3f, locked ? 0.85 : 0.45)
      .lineBetween(e.x, e.y - 10, e.x + Math.cos(e.aim) * len, e.y - 10 + Math.sin(e.aim) * len);
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
    this.hitEnemy(e, C.POISON_DPS * 0.5 * this.run.damageMul, 0, 0, 'poison');
  }

  /** Шипы: враг, коснувшийся героя, ранится (не чаще раза в секунду). */
  private applyThorns(e: Enemy): void {
    if (this.run.thorns <= 0) return;
    if (this.levelTime - (this.thornsHitAt.get(e) ?? -99) < 1) return;
    this.thornsHitAt.set(e, this.levelTime);
    this.hitEnemy(e, C.THORNS_DAMAGE * this.run.thorns * this.run.damageMul, e.x - this.player.x, e.y - this.player.y);
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

    if (e.kind === 'mole') this.syncMole(e, dt);
    if (isShielded(e)) e.sprite.setScale(s * 1.1, s * 0.7);

    // Замах перед атакой — мигание красным, чтобы успеть увернуться.
    const windup = e.state === 'windup' && Math.floor(this.time.now / 90) % 2 === 0;
    if (isHidden(e)) e.sprite.setTint(toColor(this.plan.biome.groundDark)).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (isShielded(e)) e.sprite.setTint(0x9a9aa8).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (e.flash > 0) e.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else if (windup) e.sprite.setTint(0xff5a4a).setTintMode(Phaser.TintModes.FILL);
    else if (e.slow > 0) e.sprite.setTint(0x9fe0ff).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (e.poison > 0) e.sprite.setTint(0xa8ff8a).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (this.strengthOf(e) > 1) e.sprite.setTint(0xa8dcff).setTintMode(Phaser.TintModes.MULTIPLY);
    else if (this.strengthOf(e) < 1) e.sprite.setTint(0xb8b0c0).setTintMode(Phaser.TintModes.MULTIPLY);
    else e.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);

    const lift = (e.hop + fly) / 90;
    e.shadow.setPosition(e.x, e.y).setScale((e.radius * 2.4 / 64) * (1 - lift), (e.radius * 2.4 / 64) * (1 - lift) * 0.9);

    // Враги далеко за экраном не рисуются (тень крота решает syncMole).
    const visible = this.isOnScreen(e.y);
    e.sprite.setVisible(visible);
    if (e.kind !== 'mole' || !visible) e.shadow.setVisible(visible);
  }

  /** Под землёй крот — бегущий холмик земли; наверху — сам крот. */
  private syncMole(e: Enemy, dt: number): void {
    const under = isHidden(e);
    const key = under ? 'mound' : 'mole';
    if (e.sprite.texture.key !== key) {
      e.sprite.setTexture(key);
      if (!under) this.puff(e.x, e.y, toColor(this.plan.biome.groundDark), 8);
    }
    e.shadow.setVisible(!under);
    if (under && e.awake && Math.random() < dt * 12) this.dust.emitParticleAt(e.x, e.y, 1);
  }

  private hitEnemy(e: Enemy, damage: number, dirX: number, dirY: number, source: HitSource = 'other'): void {
    if (e.dead || isHidden(e)) return;
    if (!e.awake && e.kind !== 'boss') this.wake(e);
    const isPoison = source === 'poison';
    const crit = source === 'arrow' && Math.random() < this.run.critChance;
    const dmg = Math.max(1, Math.round((damage * (crit ? 2 : 1)) / this.strengthOf(e)));
    e.hp -= dmg;
    this.run.stats.damageDealt += dmg;
    if (crit) this.run.stats.crits += 1;
    e.flash = isPoison || e.kind === 'boss' ? 0.04 : 0.09;
    e.squash = isPoison ? 0.1 : 0.28;
    if (e.kind !== 'boss') {
      e.kx += dirX * 220;
      e.ky += dirY * 220;
    }
    if (!isPoison && this.has('poison')) e.poison = C.POISON_TIME;

    const color = isPoison ? '#a8ff8a' : crit ? '#ffd23f' : '#ffffff';
    this.popText(e.x + Phaser.Math.Between(-10, 10), e.y - 40 - e.hop, `${dmg}`, color, isPoison ? 14 : crit ? 24 : 18);
    if (!isPoison) {
      sfx.hit();
      this.sparks.particleTint = 0xffffff;
      this.sparks.explode(4, e.x, e.y - 14);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    if (e.kind === 'dummy') {
      this.tutorial?.onDummyKilled(e);
    } else {
      this.run.kills += 1;
      const byKind = this.run.stats.killsByKind;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    }
    const tint = enemyTint(e.kind);

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

    if (this.has('vampire') && this.run.hp < this.run.maxHp) {
      this.run.hp = Math.min(this.run.maxHp, this.run.hp + C.VAMPIRE_HEAL);
      this.popText(this.player.x, this.player.y - 50, `+${C.VAMPIRE_HEAL}`, '#7fff9f', 16);
    }
    if (this.has('adrenaline')) {
      this.player.stamina = Math.min(this.run.maxStamina, this.player.stamina + C.ADRENALINE_STAMINA);
    }
    if (this.has('explosive') && e.kind !== 'boss') this.explode(e.x, e.y);

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
      damage: Math.round((high ? 14 : 10) * this.damageScale() * this.shooterStrength()),
      life: SHOT_LIFETIME,
      sprite, shadow, dodged: false,
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
      if (s.y > cam.scrollY + this.worldViewH() + 60 || s.y < cam.scrollY - 200 || s.x < 0 || s.x > C.GAME_WIDTH) s.life = 0;
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
        // Пролетел над присевшим или сквозь перекат — засчитываем уклонение.
        if (!s.dodged && (ducked || p.roll > 0)) {
          s.dodged = true;
          this.run.stats.dodges += 1;
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

  /** Убирает все вражеские снаряды сразу (после победы над боссом). */
  private clearShots(): void {
    for (const s of this.shots) {
      this.sparks.particleTint = s.high ? 0xffb03f : 0xd27bff;
      this.sparks.explode(2, s.x, s.y);
      s.sprite.destroy();
      s.shadow.destroy();
    }
    this.shots = [];
  }

  private spawnBlast(x: number, y: number, r: number, delay: number): void {
    const fill = this.add.image(x, y, 'disc').setTint(0xff3f3f).setScale(0).setDepth(C.DEPTH.pool + 1);
    const ring = this.add.image(x, y, 'ring').setTint(0xff3f3f).setScale((r * 2) / 128).setDepth(C.DEPTH.pool + 1).setAlpha(0.8);
    this.blasts.push({ x, y, r, timer: delay, delay, ring, fill, power: this.shooterStrength() });
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
      this.cameras.main.shake(160, 0.01 * C.BOSS_SHAKE_MUL);
      this.chunks.particleTint = 0xff7a2f;
      this.chunks.explode(16, b.x, b.y);
      this.dust.explode(10, b.x, b.y);
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + C.PLAYER_RADIUS) {
        this.hurtPlayer(Math.round(20 * this.damageScale() * b.power), b.x, b.y);
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
      if (o.age > 0.35 && (magnetAll || d < C.XP_MAGNET_RADIUS * this.run.magnetMul)) {
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
    this.run.stats.orbs += 1;
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
        this.run.upgrades.push(c.id);
        if (c.id === 'shield') this.player.shieldReady = true;
        this.player.stamina = Math.min(this.player.stamina, this.run.maxStamina);
        this.runChoices(onDone);
      });
      return;
    }
    onDone();
  }

  private resumePlay(): void {
    this.mode = 'play';
    this.mouseShotQueued = false;
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
    this.cameras.main.shake(700, 0.012 * C.BOSS_SHAKE_MUL);
    this.showBanner(boss.boss?.name ?? '', 'Босс');
    boss.squash = 0.4;
    this.time.delayedCall(1300, () => {
      boss.awake = true;
      this.bossStartTime = this.levelTime;
    });
  }

  private onBossDefeated(boss: Enemy): void {
    this.run.stats.bosses += 1;
    this.run.stats.bossTimes.push(Math.round(this.levelTime - this.bossStartTime));
    this.hitstop = C.HITSTOP_BOSS_KILL;
    this.cameras.main.shake(900, 0.02 * C.BOSS_SHAKE_MUL);
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

    // Вершина вулкана: вместо награды — спасение на вертолёте.
    if (this.isFinalLevel()) {
      this.startEnding();
      return;
    }
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
    if (this.plan.isTutorial) markTutorialDone();
    else run.stats.climb = this.totalClimb();
    run.level += 1;
    run.hp = Math.min(run.maxHp, run.hp + run.maxHp * 0.1);
    saveRun(run);
    const cam = this.cameras.main;
    cam.fadeOut(450, 20, 10, 30);
    this.uiCam?.fadeOut(450, 20, 10, 30);
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
    p.nocked.setVisible(false);
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

  // ===========================================================================
  // Финал: спасение на вертолёте
  // ===========================================================================

  /** Куда герой сам идёт во время катсцены (null — стоит или висит на лестнице). */
  private endTarget: { x: number; y: number } | null = null;
  private climbing = false;

  /**
   * Катсцена после победы над Лавовым монстром:
   * герой выходит в центр кратера → пускает сигнальную ракету → прилетает вертолёт →
   * спускается лестница → герой забирается → вертолёт улетает → экран статистики.
   */
  private startEnding(): void {
    this.mode = 'ending';
    this.climbing = false;
    clearRun();
    sfx.victory();
    const p = this.player;
    p.roll = 0;
    p.crouch = false;
    const at = (ms: number, fn: () => void) => this.time.delayedCall(ms, fn);

    at(1200, () => { this.endTarget = { x: C.GAME_WIDTH / 2, y: 470 }; });
    at(2600, () => this.fireFlare());
    at(3600, () => this.heliArrive());
    at(6000, () => this.dropLadder());
    at(6800, () => this.climbLadder());
    at(8300, () => this.heliDepart());
    at(9900, () => {
      const cam = this.cameras.main;
      cam.fadeOut(1100, 255, 246, 225);
      this.uiCam?.fadeOut(1100, 255, 246, 225);
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('EndScene', { run: this.run }));
    });
  }

  private stepEnding(dt: number): void {
    const p = this.player;
    this.updateArrows(dt);
    this.updateOrbs(dt, true);
    this.updateHeli(dt);
    if (this.climbing) return;
    if (this.endTarget) {
      p.vx = (this.endTarget.x - p.x) * 2.2;
      p.vy = (this.endTarget.y - p.y) * 2.2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (Math.hypot(this.endTarget.x - p.x, this.endTarget.y - p.y) < 3) this.endTarget = null;
    } else {
      p.vx = 0;
      p.vy = 0;
      p.aim = -Math.PI / 2;
    }
    this.syncPlayer(dt);
  }

  /** Сигнальная ракета: красная звезда взлетает вверх и вспыхивает. */
  private fireFlare(): void {
    const p = this.player;
    sfx.flare();
    const flare = this.add.image(p.x, p.y - 30, 'soft').setTint(0xff4f3f).setScale(0.8).setBlendMode(Phaser.BlendModes.ADD).setDepth(C.DEPTH.overlay - 8);
    const trail = this.add.particles(0, 0, 'soft', {
      follow: flare, lifespan: 600, speed: { min: 5, max: 30 }, scale: { start: 0.5, end: 0 },
      tint: [0xff4f3f, 0xffb03f], blendMode: 'ADD', frequency: 20,
    }).setDepth(C.DEPTH.overlay - 9);
    this.tweens.add({
      targets: flare, y: p.y - 420, duration: 1100, ease: 'Quad.Out',
      onComplete: () => {
        this.sparks.particleTint = 0xff4f3f;
        this.sparks.explode(30, flare.x, flare.y);
        this.cameras.main.flash(200, 255, 120, 100);
        sfx.boom();
        flare.destroy();
        this.time.delayedCall(600, () => trail.destroy());
      },
    });
  }

  private heliArrive(): void {
    const body = this.add.image(C.GAME_WIDTH / 2 + this.worldViewW() / 2 + 200, -150, 'heli').setDepth(C.DEPTH.overlay - 7).setAngle(-8);
    const rotor = this.add.image(body.x, body.y, 'rotor').setDepth(C.DEPTH.overlay - 6).setAlpha(0.8);
    const shadow = this.add.image(body.x, body.y, 'shadow').setDepth(C.DEPTH.shadow).setScale(3, 2).setAlpha(0);
    const ladder = this.add.graphics().setDepth(C.DEPTH.overlay - 8);
    this.heli = { body, rotor, shadow, ladder, chop: 0 };
    this.ladderLength = 0;
    this.tweens.add({ targets: body, x: C.GAME_WIDTH / 2 + 10, y: 250, angle: 0, duration: 2300, ease: 'Sine.Out' });
  }

  /** Длина верёвочной лестницы под вертолётом. */
  private ladderLength = 0;

  private dropLadder(): void {
    if (!this.heli) return;
    sfx.select();
    this.tweens.add({ targets: this, ladderLength: this.player.y - 20 - (this.heli.body.y + 30), duration: 600, ease: 'Bounce.Out' });
  }

  private climbLadder(): void {
    const p = this.player;
    const heli = this.heli;
    if (!heli) return;
    this.climbing = true;
    p.bow.setVisible(false);
    p.nocked.setVisible(false);
    p.orbitSprites.forEach((s) => s.setVisible(false));
    p.shieldRing.setVisible(false);
    p.sprite.setRotation(0).setScale(1).setDepth(C.DEPTH.overlay - 7.5);
    this.tweens.add({ targets: p.shadow, alpha: 0, duration: 800 });
    this.tweens.add({ targets: p.sprite, y: heli.body.y + 50, duration: 1400, ease: 'Sine.InOut' });
    this.tweens.add({ targets: this, ladderLength: 40, duration: 1400, ease: 'Sine.InOut' });
    this.tweens.add({ targets: p.sprite, angle: { from: -6, to: 6 }, duration: 180, yoyo: true, repeat: 7 });
  }

  private heliDepart(): void {
    const heli = this.heli;
    if (!heli) return;
    sfx.gateOpen();
    const dx = -this.worldViewW();
    const dy = -520;
    this.tweens.add({ targets: heli.body, x: heli.body.x + dx, y: heli.body.y + dy, angle: -14, duration: 2600, ease: 'Sine.In' });
    this.tweens.add({ targets: this.player.sprite, x: this.player.sprite.x + dx, y: this.player.sprite.y + dy, duration: 2600, ease: 'Sine.In' });
  }

  /** Винт крутится, вертолёт стрекочет и поднимает пыль, лестница качается. */
  private updateHeli(dt: number): void {
    const heli = this.heli;
    if (!heli) return;
    const { body, rotor, shadow, ladder } = heli;
    rotor.setPosition(body.x - 29, body.y - 39).setRotation(rotor.rotation + dt * 32);

    heli.chop -= dt;
    if (heli.chop <= 0) {
      heli.chop = 0.085;
      sfx.chop();
    }

    const groundY = 470;
    const height = Math.max(0, groundY - body.y);
    shadow.setPosition(body.x, groundY).setAlpha(Phaser.Math.Clamp(0.6 - height / 900, 0, 0.5));
    if (height < 320 && Math.random() < dt * 30) this.dust.emitParticleAt(body.x + Phaser.Math.Between(-120, 120), groundY, 1);

    ladder.clear();
    if (this.ladderLength <= 0) return;
    const sway = Math.sin(this.time.now / 260) * 6;
    const topY = body.y + 30;
    const bottomY = topY + this.ladderLength;
    ladder.lineStyle(2, 0xe8dcc0, 1);
    ladder.lineBetween(body.x - 8, topY, body.x - 8 + sway, bottomY);
    ladder.lineBetween(body.x + 8, topY, body.x + 8 + sway, bottomY);
    ladder.lineStyle(2, 0x9a6a42, 1);
    for (let y = topY + 10; y < bottomY; y += 12) {
      const s = sway * ((y - topY) / this.ladderLength);
      ladder.lineBetween(body.x - 8 + s, y, body.x + 8 + s, y);
    }
  }

  // ===========================================================================
  // Пауза
  // ===========================================================================

  private togglePause(): void {
    if (this.mode === 'play') this.openPause();
    else if (this.mode === 'pause') this.closePause();
  }

  private openPause(): void {
    this.mode = 'pause';
    this.time.paused = true;
    this.tweens.pauseAll();
    sfx.pause();

    const cx = viewWidth(this) / 2;
    const style = { fontFamily: C.FONT, fontStyle: 'bold', stroke: '#1a1020', align: 'center' };
    const parts: Phaser.GameObjects.GameObject[] = [];
    const fixed = <O extends Phaser.GameObjects.GameObject & { setScrollFactor(x: number): O; setDepth(d: number): O }>(o: O): O => {
      parts.push(o.setScrollFactor(0).setDepth(C.DEPTH.modal + 1));
      return o;
    };

    fixed(this.add.rectangle(cx, viewHeight(this) / 2, viewWidth(this), viewHeight(this), 0x140a20, 0.9));
    fixed(this.add.text(cx, 92, 'Пауза', { ...style, fontSize: '48px', color: '#fff3c4', strokeThickness: 8 }).setOrigin(0.5));
    fixed(this.add.text(cx, 150, `${this.plan.biome.name} · уровень ${this.run.level}/${C.LEVELS_PER_SEASON}`, {
      ...style, fontSize: '20px', color: '#ffd8a0', strokeThickness: 4,
    }).setOrigin(0.5));
    fixed(this.add.text(cx, 200, this.buildSummary(), {
      ...style, fontSize: '16px', color: '#e8dccc', strokeThickness: 3, lineSpacing: 6, wordWrap: { width: 700 },
    }).setOrigin(0.5, 0));

    this.pauseButton(fixed, 360, 'Продолжить', true, () => this.closePause());
    this.pauseButton(fixed, 422, 'Начать уровень заново', false, () => this.leavePause(() => {
      this.scene.restart({ run: loadRun() ?? newRun(this.run.season) });
    }));
    this.pauseButton(fixed, 484, 'Главное меню', false, () => this.leavePause(() => this.scene.start('MenuScene')));
    if (this.touch) {
      this.pauseButton(fixed, 546, 'Настроить управление', false, () => openTouchEditor(this, () => this.touch?.reloadLayout()));
    }

    const controls = this.touch
      ? 'Джойстик — идти   ·   стрельба автоматическая   ·   Рывок и Присед — кнопки'
      : [
        'WASD — идти   ·   Пробел / ЛКМ — стрелять   ·   Shift — перекат',
        'Ctrl / C / ПКМ — присесть   ·   Esc — продолжить',
      ].join('\n');
    fixed(this.add.text(cx, viewHeight(this) - (this.touch ? 36 : 62), controls, {
      ...style, fontSize: '15px', color: '#b8a8b8', strokeThickness: 3,
    }).setOrigin(0.5));
    this.pauseParts = parts;
  }

  /** Сводка прокачки героя для экрана паузы. */
  private buildSummary(): string {
    const r = this.run;
    const pct = (v: number) => `+${Math.round((v - 1) * 100)}%`;
    const bow = [
      `стрел подряд: ${r.burst}`,
      r.spread ? 'веер \\|/' : '',
      r.ring ? 'кольцо' : '',
      r.damageMul > 1 ? `урон ${pct(r.damageMul)}` : '',
      r.fireRateMul > 1 ? `скорострельность ${pct(r.fireRateMul)}` : '',
    ].filter(Boolean).join(' · ');
    const body = `здоровье ${Math.ceil(r.hp)}/${r.maxHp} · выносливость ${r.maxStamina}`
      + (r.speedMul > 1 ? ` · скорость ${pct(r.speedMul)}` : '');
    const armor = [
      r.orbit > 0 ? `орбита ×${r.orbit}` : '',
      r.shield > 0 ? `щит ур. ${r.shield}` : '',
      r.thorns > 0 ? `шипы ур. ${r.thorns}` : '',
      r.critChance > 0 ? `крит ${Math.round(r.critChance * 100)}%` : '',
      r.regen > 0 ? `реген ${r.regen} HP/с` : '',
      r.magnetMul > 1 ? 'магнит' : '',
    ].filter(Boolean).join(' · ');
    const abilities = r.abilities.map((id) => ABILITIES.find((a) => a.id === id)?.title ?? id).join(', ') || 'пока нет';
    return `Лук: ${bow}\nГерой: ${body}\nБроня: ${armor || 'пока нет'}\nАбилки: ${abilities}\nВрагов повержено: ${r.kills}`;
  }

  private pauseButton(
    fixed: <O extends Phaser.GameObjects.Text>(o: O) => O,
    y: number,
    label: string,
    primary: boolean,
    onClick: () => void,
  ): void {
    const button = fixed(this.add.text(viewWidth(this) / 2, y, label, {
      fontFamily: C.FONT, fontStyle: 'bold', fontSize: '24px', color: '#1a1020',
      backgroundColor: primary ? '#ffd23f' : '#f3ead6', padding: { x: 24, y: 10 },
    }).setOrigin(0.5));
    // Твины на паузе остановлены, поэтому наведение — мгновенное.
    button.setInteractive({ useHandCursor: true })
      .on('pointerover', () => { button.setScale(1.06); sfx.select(); })
      .on('pointerout', () => button.setScale(1))
      .on('pointerdown', onClick);
  }

  private closePause(): void {
    this.destroyPause();
    this.mode = 'play';
    this.mouseShotQueued = false;
    this.player.invuln = Math.max(this.player.invuln, 0.5);
    sfx.pause();
    // Если пока стояли на паузе накопились выборы (например, после босса) — показываем.
    if (this.pendingAbility || this.pendingUpgrades > 0) this.runChoices(() => this.resumePlay());
  }

  private leavePause(next: () => void): void {
    this.destroyPause();
    sfx.pick();
    next();
  }

  private destroyPause(): void {
    this.pauseParts?.forEach((p) => p.destroy());
    this.pauseParts = null;
    this.time.paused = false;
    this.tweens.resumeAll();
  }

  // ===========================================================================
  // UI-эффекты
  // ===========================================================================

  /**
   * Всплывающий текст. Цифры урона идут через растровый шрифт и пул объектов —
   * это дёшево даже при десятках попаданий в секунду.
   */
  private popText(x: number, y: number, text: string, color: string, size: number): void {
    if ([...text].every((ch) => DAMAGE_FONT_CHARS.includes(ch))) {
      this.popNumber(x, y, text, color, size);
      return;
    }
    const t = this.add.text(x, y, text, {
      fontFamily: C.FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(C.DEPTH.overlay - 1).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, delay: 200, duration: 450, ease: 'Quad.In', onComplete: () => t.destroy() });
  }

  private popNumber(x: number, y: number, text: string, color: string, size: number): void {
    if (this.popActive >= C.MAX_POPUPS) return;
    const t = this.popPool.pop() ?? this.add.bitmapText(0, 0, 'dmg', '').setOrigin(0.5).setDepth(C.DEPTH.overlay - 1);
    this.popActive += 1;
    // Шрифт нарисован с детализацией RENDER_SCALE — уменьшаем обратно.
    const scale = size / 22 / RENDER_SCALE;
    t.setText(text).setPosition(x, y).setTint(toColor(color)).setAlpha(1).setVisible(true).setScale(scale * 0.4);
    this.tweens.add({ targets: t, scale, duration: 120, ease: 'Back.Out' });
    this.tweens.add({
      targets: t, y: y - 34, alpha: 0, delay: 200, duration: 450, ease: 'Quad.In',
      onComplete: () => {
        t.setVisible(false);
        this.popPool.push(t);
        this.popActive -= 1;
      },
    });
  }

  private puff(x: number, y: number, tint: number, count: number): void {
    this.chunks.particleTint = tint;
    this.chunks.explode(count, x, y);
    this.dust.explode(count, x, y);
  }

  private showBanner(title?: string, subtitle?: string): void {
    const plan = this.plan;
    const main = title ?? (plan.isTutorial ? 'Обучение' : plan.biome.name);
    const sub = subtitle ?? (plan.isTutorial ? 'Перед восхождением' : plan.isBoss ? `Уровень ${plan.level} · логово босса` : `Уровень ${plan.level} из ${C.LEVELS_PER_SEASON}`);
    const style = { fontFamily: C.FONT, fontStyle: 'bold', stroke: '#1a1020' };
    const big = this.add.text(viewWidth(this) / 2, 190, main, { ...style, fontSize: '54px', color: '#fff6dc', strokeThickness: 8 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.hud + 5).setAlpha(0).setScale(1.4);
    const small = this.add.text(viewWidth(this) / 2, 246, sub, { ...style, fontSize: '20px', color: '#ffd8a0', strokeThickness: 5 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(C.DEPTH.hud + 5).setAlpha(0);
    this.tweens.add({ targets: big, alpha: 1, scale: 1, duration: 420, ease: 'Back.Out' });
    this.tweens.add({ targets: small, alpha: 1, duration: 300, delay: 200 });
    this.tweens.add({
      targets: [big, small], alpha: 0, y: '-=20', delay: 1800, duration: 500,
      onComplete: () => { big.destroy(); small.destroy(); },
    });
  }

  private showPanel(title: string, body: string, action: string, onAction: () => void): void {
    const cx = viewWidth(this) / 2;
    const cy = viewHeight(this) / 2;
    const style = { fontFamily: C.FONT, fontStyle: 'bold', stroke: '#1a1020', align: 'center' };
    const dim = this.add.rectangle(cx, cy, viewWidth(this), viewHeight(this), 0x140a20, 0.7).setScrollFactor(0).setDepth(C.DEPTH.modal).setAlpha(0);
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
