/**
 * Все важные игровые параметры собраны здесь, чтобы их было легко крутить.
 */

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;

// --- Мир и уровни ---------------------------------------------------------

/** Ширина скал по краям коридора. */
export const SIDE_WALL = 70;
export const LEVELS_PER_SEASON = 35;
export const BOSS_EVERY = 7;
export const LEVEL_MIN_LENGTH = 1800;
export const LEVEL_MAX_LENGTH = 4400;
export const BOSS_LEVEL_LENGTH = 1700;
/** Высота арены босса (равна экрану — камера на арене замирает). */
export const BOSS_ARENA_HEIGHT = GAME_HEIGHT;
/** Пустая зона у старта и у выхода, где нет врагов и препятствий. */
export const SAFE_START = 460;
export const SAFE_EXIT = 380;
/** Y-координата флага-выхода (верх уровня). */
export const EXIT_Y = 150;
/** На какой доле высоты экрана держится игрок, пока камера едет вверх. */
export const CAMERA_ANCHOR = 0.62;
/** Враг просыпается, когда заходит на экран глубже чем на столько пикселей. */
export const WAKE_INSET = 30;
/** Первые секунды уровня враги не просыпаются — время оглядеться. */
export const START_GRACE = 1.6;

// --- Игрок ------------------------------------------------------------------

export const PLAYER_RADIUS = 13;
export const PLAYER_BASE_SPEED = 235;
export const PLAYER_ACCEL = 14;
export const PLAYER_BASE_HP = 100;
export const PLAYER_BASE_STAMINA = 100;
export const CROUCH_SPEED_MUL = 0.45;
export const CROUCH_RADIUS_MUL = 0.7;
export const STAMINA_REGEN = 30;
export const STAMINA_REGEN_CROUCH = 62;
export const STAMINA_REGEN_DELAY = 0.45;
export const ROLL_COST = 32;
export const ROLL_SPEED = 660;
export const ROLL_DURATION = 0.27;
export const HURT_INVULNERABILITY = 0.75;
export const POOL_SLOW_MUL = 0.55;
export const LAVA_DPS = 22;

// --- Лук --------------------------------------------------------------------

export const FIRE_INTERVAL = 0.4;
export const ARROW_SPEED = 800;
export const ARROW_DAMAGE = 10;
export const ARROW_LIFETIME = 0.8;
export const ARROW_RADIUS = 7;
/** Пауза между стрелами в очереди (апгрейд "1 → 3 стрелы"). */
export const BURST_DELAY = 0.075;
export const MAX_BURST = 3;
/** Угол веера \|/ в радианах. */
export const SPREAD_ANGLE = 0.26;
export const RING_ARROWS = 8;
/** Кольцо стрел выпускается раз в N залпов. */
export const RING_EVERY_VOLLEYS = 3;
export const RING_DAMAGE_MUL = 0.6;
export const AUTO_AIM_RANGE = 560;

// --- Опыт -------------------------------------------------------------------

export const XP_MAGNET_RADIUS = 140;
export const XP_PICKUP_RADIUS = 24;
/** В среднем одно усиление на столько уровней (если убивать всех). */
export const LEVELS_PER_UPGRADE = 2.5;

// --- Ощущения -----------------------------------------------------------------

export const HITSTOP_HIT = 0.012;
export const HITSTOP_KILL = 0.04;
export const HITSTOP_BOSS_KILL = 0.35;

// --- Боссы и враги --------------------------------------------------------------

export const BOSS_BASE_HP = 850;
export const BOSS_HP_GROWTH = 0.75;
export const BOSS_PHASE2_AT = 0.5;
export const ENEMY_SHOT_RADIUS = 9;
export const HIGH_SHOT_HEIGHT = 26;

// --- Способности ----------------------------------------------------------------

export const FROST_ROLL_RADIUS = 130;
export const FROST_SLOW_TIME = 2.5;
export const FROST_SLOW_MUL = 0.35;
export const SHOCK_ROLL_DAMAGE = 30;
export const POISON_DPS = 4;
export const POISON_TIME = 3;
export const VAMPIRE_HEAL = 3;
export const SHELTER_DAMAGE_MUL = 0.5;
export const LIGHT_ROLL_COST_MUL = 0.6;

export const SAVE_KEY = 'peak-archer-save-v1';

export const DEPTH = {
  ground: 0,
  decal: 1,
  pool: 2,
  shadow: 3,
  world: 10,
  overlay: 90000,
  hud: 100000,
  modal: 110000,
} as const;

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
