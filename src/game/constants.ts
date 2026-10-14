/**
 * Все важные игровые параметры собраны здесь, чтобы их было легко крутить.
 */

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;
/** Максимальная детализация холста (x2 = 4x пикселей; выше — тяжело для слабых видеокарт). */
export const MAX_RENDER_SCALE = 2;

// --- Мир и уровни ---------------------------------------------------------

/** Ширина скал по краям коридора. */
export const SIDE_WALL = 70;
/** Сколько скал дорисовывать за краями поля — для широких экранов (до ~21:9). */
export const SIDE_EXTRA = 600;
/** Шаг рядов дальних скал за краями поля. */
export const OUTER_CLIFF_STEP = 110;
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
/** Насколько лук вынесен от героя и как быстро доворачивается к цели. */
export const BOW_DISTANCE = 28;
/** Лук держится на уровне груди скаута (пикселей над ногами). */
export const BOW_CHEST_HEIGHT = 24;
export const BOW_TURN_SPEED = 22;
/** На сколько пикселей лук отскакивает назад при выстреле. */
export const BOW_KICK_BACK = 9;
/** Сколько секунд после выстрела стрела выглядит вытянутой (эффект скорости). */
export const ARROW_STRETCH_TIME = 0.12;
/** С какого уровня можно получить 2-ю и 3-ю стрелу очереди. */
export const BURST_UNLOCK_LEVELS = [3, 9];
export const SPREAD_UNLOCK_LEVEL = 6;
export const RING_UNLOCK_LEVEL = 12;

// --- Активная броня и пассивки ------------------------------------------------

export const MAX_ORBIT = 4;
export const ORBIT_RADIUS = 46;
export const ORBIT_SPEED = 3.2;
export const ORBIT_DAMAGE = 7;
/** Пауза между ударами одной орбитальной стрелы по одному врагу. */
export const ORBIT_HIT_COOLDOWN = 0.45;
/** Перезарядка щита в секундах по уровню щита (1, 2, 3). */
export const SHIELD_COOLDOWNS = [12, 9, 6];
export const THORNS_DAMAGE = 12;
export const LIGHTNING_INTERVAL = 2.2;
export const LIGHTNING_RANGE = 360;
export const LIGHTNING_DAMAGE = 26;
export const EXPLOSION_RADIUS = 80;
export const EXPLOSION_DAMAGE = 18;
export const FROST_ARROW_SLOW_TIME = 1.2;
export const SECOND_WIND_HEAL = 0.4;
export const ADRENALINE_STAMINA = 15;

// --- Опыт -------------------------------------------------------------------

export const XP_MAGNET_RADIUS = 140;
export const XP_PICKUP_RADIUS = 24;
/** В среднем одно усиление на столько уровней (если убивать всех). */
export const LEVELS_PER_UPGRADE = 1.15;

// --- Рост силы врагов ---------------------------------------------------------

/** HP врагов растёт на столько за каждый пройденный уровень сезона... */
export const ENEMY_HP_PER_LEVEL = 0.12;
/** ...но не быстрее, чем эта доля от роста атакующей силы героя. */
export const ENEMY_HP_TRACKING = 0.6;
/** Каждый новый сезон враги крепче (герой начинает заново). */
export const ENEMY_HP_PER_SEASON = 0.3;
/** Оценка вклада апгрейдов в силу атаки. */
export const SPREAD_POWER = 1.5;
export const RING_POWER = 1.25;

// --- Ощущения -----------------------------------------------------------------

export const HITSTOP_BOSS_KILL = 0.35;
/** Множитель тряски от босса и врагов (атаки, взрывы, появление, смерть босса). 0.1 = на 90% слабее. */
export const BOSS_SHAKE_MUL = 0.1;

// --- Боссы и враги --------------------------------------------------------------

export const BOSS_BASE_HP = 600;
/** Лавовый монстр на вершине вулкана (уровень 35) — крепче обычного босса. */
export const FINAL_BOSS_HP_MUL = 1.6;
/** Дополнительный множитель HP боссов: у первого босса и у последнего (между ними — плавно). */
export const BOSS_HP_BOOST_FIRST = 3;
export const BOSS_HP_BOOST_LAST = 5;
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

export const SAVE_KEY = 'summit-shot-save-v1';
/** Отметка, что обучение пройдено — второй раз его не показываем. */
export const TUTORIAL_KEY = 'summit-shot-tutorial-done';

// --- Обучение (уровень 0) --------------------------------------------------------

export const TUTORIAL_LENGTH = 1500;
/** Бревно во всю ширину прохода — под ним нужно проползти в приседе. */
export const TUTORIAL_BEAM_Y = 620;
/** Как часто мишень-стрелок стреляет на шаге с перекатом. */
export const TUTORIAL_SHOT_INTERVAL = 1.3;
export const TUTORIAL_SHOT_SPEED = 230;
export const GAME_TITLE = 'SUMMIT SHOT';

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

/** Сколько цифр урона может висеть на экране одновременно. */
export const MAX_POPUPS = 40;
/** Запас за краями экрана, внутри которого объекты ещё рисуются. */
export const CULL_MARGIN = 220;
