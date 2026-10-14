import Phaser from 'phaser';
import {
  DEPTH,
  FONT,
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_GRAB_MUL,
  JOYSTICK_KNOB_RADIUS,
  JOYSTICK_RADIUS,
  TOUCH_BUTTON_RADIUS,
  TOUCH_LABEL_SIZE,
  TOUCH_LAYOUT_KEY,
  TOUCH_PAUSE_RADIUS,
  TOUCH_SIZE_MAX,
  TOUCH_SIZE_MIN,
  TOUCH_SIZE_STEP,
} from './constants';
import { sfx } from './sfx';
import { RENDER_SCALE, viewHeight, viewWidth } from './view';

/**
 * Сенсорное управление для телефонов и планшетов:
 * джойстик (ходьба), кнопки "Рывок" и "Присед", кнопка паузы. Стрельба — автоматическая.
 * Расположение и размер джойстика и кнопок игрок настраивает сам (openTouchEditor).
 */

export type TouchElementId = 'joystick' | 'roll' | 'crouch';

/** x, y — доли ширины и высоты экрана (0..1), чтобы раскладка подходила под любой экран. */
interface ElementLayout { x: number; y: number; size: number }
type TouchLayout = Record<TouchElementId, ElementLayout>;

const IDS: TouchElementId[] = ['joystick', 'roll', 'crouch'];
const LABELS: Record<TouchElementId, string> = { joystick: 'Джойстик', roll: 'Рывок', crouch: 'Присед' };

/** По умолчанию: джойстик внизу по центру, кнопки — под правым большим пальцем. */
const DEFAULT_LAYOUT: TouchLayout = {
  joystick: { x: 0.5, y: 0.78, size: 1 },
  roll: { x: 0.88, y: 0.66, size: 1 },
  crouch: { x: 0.77, y: 0.84, size: 1 },
};

export { isTouchDevice } from './view';

function clampPos(v: number): number {
  return Phaser.Math.Clamp(v, 0.04, 0.96);
}

function clampSize(v: number): number {
  return Phaser.Math.Clamp(v, TOUCH_SIZE_MIN, TOUCH_SIZE_MAX);
}

function isElementLayout(v: unknown): v is ElementLayout {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.x === 'number' && typeof e.y === 'number' && typeof e.size === 'number';
}

function defaultLayout(): TouchLayout {
  return {
    joystick: { ...DEFAULT_LAYOUT.joystick },
    roll: { ...DEFAULT_LAYOUT.roll },
    crouch: { ...DEFAULT_LAYOUT.crouch },
  };
}

function loadLayout(): TouchLayout {
  const layout = defaultLayout();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TOUCH_LAYOUT_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return layout;
    for (const id of IDS) {
      const e = (raw as Record<string, unknown>)[id];
      if (isElementLayout(e)) layout[id] = { x: clampPos(e.x), y: clampPos(e.y), size: clampSize(e.size) };
    }
  } catch {
    // битые данные — раскладка по умолчанию
  }
  return layout;
}

function saveLayout(layout: TouchLayout): void {
  try {
    localStorage.setItem(TOUCH_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

/** Сколько логических пикселей в одном CSS-пикселе экрана. */
function cssUnit(scene: Phaser.Scene): number {
  return viewWidth(scene) / Math.max(1, scene.scale.displaySize.width);
}

function radiusOf(scene: Phaser.Scene, id: TouchElementId, size: number): number {
  return (id === 'joystick' ? JOYSTICK_RADIUS : TOUCH_BUTTON_RADIUS) * size * cssUnit(scene);
}

/** Подписи рисуются крупным шрифтом и уменьшаются — так они чёткие при любом масштабе. */
const LABEL_FONT_PX = 32;

function labelScale(scene: Phaser.Scene, size: number): number {
  return (TOUCH_LABEL_SIZE * size * cssUnit(scene)) / LABEL_FONT_PX;
}

function screenPos(scene: Phaser.Scene, e: ElementLayout): { x: number; y: number } {
  return { x: e.x * viewWidth(scene), y: e.y * viewHeight(scene) };
}

/** Палец в логических координатах экрана (камера увеличена в RENDER_SCALE раз). */
function pointerPos(p: Phaser.Input.Pointer): { x: number; y: number } {
  return { x: p.x / RENDER_SCALE, y: p.y / RENDER_SCALE };
}

function makeLabel(scene: Phaser.Scene, text: string, depth: number): Phaser.GameObjects.Text {
  return scene.add.text(0, 0, text, {
    fontFamily: FONT, fontSize: `${LABEL_FONT_PX}px`, fontStyle: 'bold', color: '#fff6dc', stroke: '#1a1020', strokeThickness: 7,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(depth);
}

/** Рисует элемент управления; knob — смещение ручки джойстика (-1..1). */
function drawElement(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  id: TouchElementId,
  x: number,
  y: number,
  size: number,
  opts: { pressed?: boolean; selected?: boolean; knobX?: number; knobY?: number } = {},
): void {
  const r = radiusOf(scene, id, size);
  const outline = opts.selected ? 0xffd23f : 0xffffff;
  g.fillStyle(opts.pressed ? 0xffd23f : 0x1a1020, opts.pressed ? 0.45 : 0.35).fillCircle(x, y, r);
  g.lineStyle(opts.selected ? 4 : 3, outline, opts.selected ? 1 : 0.55).strokeCircle(x, y, r);
  if (id !== 'joystick') return;
  const kx = x + (opts.knobX ?? 0) * r;
  const ky = y + (opts.knobY ?? 0) * r;
  g.fillStyle(0xffffff, 0.55).fillCircle(kx, ky, JOYSTICK_KNOB_RADIUS * size * cssUnit(scene));
}

/** Джойстик и кнопки во время игры. Мультитач: можно идти и жать кнопку одновременно. */
export class TouchControls {
  private layout = loadLayout();
  private g: Phaser.GameObjects.Graphics;
  private labels: Record<'roll' | 'crouch', Phaser.GameObjects.Text>;
  private pauseLabel: Phaser.GameObjects.Text;
  private stickPointer = -1;
  private stickX = 0;
  private stickY = 0;
  private crouchPointer = -1;
  private rollQueued = false;
  private rollFlash = 0;
  private active = true;

  constructor(private scene: Phaser.Scene, private onPause: () => void) {
    const depth = DEPTH.hud + 5;
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(depth);
    this.labels = { roll: makeLabel(scene, 'Рывок', depth + 1), crouch: makeLabel(scene, 'Присед', depth + 1) };
    this.pauseLabel = makeLabel(scene, 'II', depth + 1);

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    });
  }

  /** Вне игры (пауза, выбор усиления, катсцена) управление скрыто и отпущено. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
      this.crouchPointer = -1;
      this.rollQueued = false;
    }
    this.g.setVisible(on);
    this.labels.roll.setVisible(on);
    this.labels.crouch.setVisible(on);
    this.pauseLabel.setVisible(on);
  }

  /** Перечитать раскладку после настройки. */
  reloadLayout(): void {
    this.layout = loadLayout();
  }

  /** Направление движения: длина 0..1 (чем дальше ручка, тем быстрее). */
  move(): { x: number; y: number } {
    const len = Math.hypot(this.stickX, this.stickY);
    if (len < JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
    const k = (len - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE) / len;
    return { x: this.stickX * k, y: this.stickY * k };
  }

  get crouching(): boolean {
    return this.crouchPointer !== -1;
  }

  /** Было ли нажатие "Рывка" с прошлого кадра. */
  consumeRoll(): boolean {
    const queued = this.rollQueued;
    this.rollQueued = false;
    return queued;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.rollFlash = Math.max(0, this.rollFlash - dt);
    const g = this.g;
    g.clear();
    const stick = this.layout.joystick;
    const sp = screenPos(this.scene, stick);
    drawElement(this.scene, g, 'joystick', sp.x, sp.y, stick.size, { knobX: this.stickX, knobY: this.stickY, pressed: this.stickPointer !== -1 });
    for (const id of ['roll', 'crouch'] as const) {
      const e = this.layout[id];
      const p = screenPos(this.scene, e);
      const pressed = id === 'roll' ? this.rollFlash > 0 : this.crouching;
      drawElement(this.scene, g, id, p.x, p.y, e.size, { pressed });
      this.labels[id].setPosition(p.x, p.y).setScale(labelScale(this.scene, e.size));
    }
    const pause = this.pausePos();
    const pr = this.pauseRadius();
    g.fillStyle(0x1a1020, 0.4).fillCircle(pause.x, pause.y, pr);
    g.lineStyle(2, 0xffffff, 0.55).strokeCircle(pause.x, pause.y, pr);
    this.pauseLabel.setPosition(pause.x, pause.y).setScale(labelScale(this.scene, 1.3));
  }

  /** Справа под уровнем и фазой суток — сверху по центру имя и полоса босса. */
  private pausePos(): { x: number; y: number } {
    const r = this.pauseRadius();
    return { x: viewWidth(this.scene) - r - 14, y: 84 + r };
  }

  private pauseRadius(): number {
    return TOUCH_PAUSE_RADIUS * cssUnit(this.scene);
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (!this.active) return;
    sfx.unlock();
    const { x, y } = pointerPos(pointer);
    const pause = this.pausePos();
    if (Math.hypot(x - pause.x, y - pause.y) <= this.pauseRadius() * 1.5) {
      this.onPause();
      return;
    }
    for (const id of ['roll', 'crouch'] as const) {
      const e = this.layout[id];
      const p = screenPos(this.scene, e);
      if (Math.hypot(x - p.x, y - p.y) > radiusOf(this.scene, id, e.size) * 1.15) continue;
      if (id === 'roll') {
        this.rollQueued = true;
        this.rollFlash = 0.15;
      } else {
        this.crouchPointer = pointer.id;
      }
      return;
    }
    const stick = this.layout.joystick;
    const sp = screenPos(this.scene, stick);
    if (this.stickPointer === -1 && Math.hypot(x - sp.x, y - sp.y) <= radiusOf(this.scene, 'joystick', stick.size) * JOYSTICK_GRAB_MUL) {
      this.stickPointer = pointer.id;
      this.setStick(x, y);
    }
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.stickPointer) return;
    const { x, y } = pointerPos(pointer);
    this.setStick(x, y);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.stickPointer) {
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
    }
    if (pointer.id === this.crouchPointer) this.crouchPointer = -1;
  }

  private setStick(x: number, y: number): void {
    const stick = this.layout.joystick;
    const sp = screenPos(this.scene, stick);
    const r = radiusOf(this.scene, 'joystick', stick.size);
    let dx = (x - sp.x) / r;
    let dy = (y - sp.y) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.stickX = dx;
    this.stickY = dy;
  }
}

/**
 * Экран настройки сенсорного управления: перетаскивание джойстика и кнопок,
 * размер выбранного элемента (−/+), сброс к раскладке по умолчанию.
 * Работает и в меню, и на паузе; onClose вызывается после "Готово".
 */
export function openTouchEditor(scene: Phaser.Scene, onClose: () => void): void {
  const depth = DEPTH.modal + 20;
  let layout = loadLayout();
  let selected: TouchElementId = 'joystick';
  let dragPointer = -1;
  let dragOffX = 0;
  let dragOffY = 0;

  const parts: Phaser.GameObjects.GameObject[] = [];
  const fixed = <O extends Phaser.GameObjects.GameObject & { setScrollFactor(x: number): O; setDepth(d: number): O }>(o: O): O => {
    parts.push(o.setScrollFactor(0).setDepth(depth));
    return o;
  };
  const w = viewWidth(scene);
  const h = viewHeight(scene);
  const cx = w / 2;
  const style = { fontFamily: FONT, fontStyle: 'bold', stroke: '#1a1020', align: 'center' };

  // Затемнение ловит нажатия, чтобы кнопки меню/паузы под ним не срабатывали.
  fixed(scene.add.rectangle(cx, h / 2, w, h, 0x140a20, 0.88).setInteractive());
  fixed(scene.add.text(cx, 40, 'Настройка управления', { ...style, fontSize: '30px', color: '#fff3c4', strokeThickness: 6 }).setOrigin(0.5));
  fixed(scene.add.text(cx, 76, 'Перетащи джойстик или кнопку пальцем. Выбранный элемент можно уменьшить или увеличить.', {
    ...style, fontSize: '15px', color: '#e8dccc', strokeThickness: 3, wordWrap: { width: Math.min(w - 32, 760) },
  }).setOrigin(0.5));
  const sizeText = fixed(scene.add.text(cx, 176, '', { ...style, fontSize: '16px', color: '#ffd8a0', strokeThickness: 3 }).setOrigin(0.5));
  const g = fixed(scene.add.graphics());
  const labels = IDS.map((id) => fixed(makeLabel(scene, LABELS[id], depth)));

  const buttons: Phaser.GameObjects.Text[] = [];
  const button = (x: number, label: string, primary: boolean, onClick: () => void) => {
    const b = fixed(scene.add.text(x, 128, label, {
      fontFamily: FONT, fontStyle: 'bold', fontSize: '22px', color: '#1a1020',
      backgroundColor: primary ? '#ffd23f' : '#f3ead6', padding: { x: 18, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    b.on('pointerdown', () => {
      sfx.select();
      onClick();
    });
    buttons.push(b);
  };

  const redraw = () => {
    g.clear();
    IDS.forEach((id, i) => {
      const e = layout[id];
      const p = screenPos(scene, e);
      drawElement(scene, g, id, p.x, p.y, e.size, { selected: id === selected });
      const labelY = id === 'joystick' ? p.y + radiusOf(scene, id, e.size) + 10 * cssUnit(scene) : p.y;
      labels[i].setPosition(p.x, labelY).setScale(labelScale(scene, e.size));
    });
    sizeText.setText(`${LABELS[selected]} · размер ${Math.round(layout[selected].size * 100)}%`);
  };

  const resize = (delta: number) => {
    layout[selected].size = clampSize(Math.round((layout[selected].size + delta) * 10) / 10);
    saveLayout(layout);
    redraw();
  };

  button(cx - 250, '−', false, () => resize(-TOUCH_SIZE_STEP));
  button(cx - 185, '+', false, () => resize(TOUCH_SIZE_STEP));
  button(cx - 30, 'Сбросить', false, () => {
    try {
      localStorage.removeItem(TOUCH_LAYOUT_KEY);
    } catch {
      // ignore
    }
    layout = loadLayout();
    redraw();
  });
  button(cx + 170, 'Готово', true, () => close());

  const onDown = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
    if (over.some((o) => buttons.includes(o as Phaser.GameObjects.Text))) return;
    const { x, y } = pointerPos(pointer);
    // Ищем ближайший элемент под пальцем.
    let best: TouchElementId | null = null;
    let bestD = Infinity;
    for (const id of IDS) {
      const p = screenPos(scene, layout[id]);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= radiusOf(scene, id, layout[id].size) * 1.2 && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    if (!best) return;
    selected = best;
    dragPointer = pointer.id;
    const p = screenPos(scene, layout[best]);
    dragOffX = p.x - x;
    dragOffY = p.y - y;
    redraw();
  };
  const onMove = (pointer: Phaser.Input.Pointer) => {
    if (pointer.id !== dragPointer) return;
    const { x, y } = pointerPos(pointer);
    layout[selected].x = clampPos((x + dragOffX) / viewWidth(scene));
    layout[selected].y = clampPos((y + dragOffY) / viewHeight(scene));
    redraw();
  };
  const onUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.id !== dragPointer) return;
    dragPointer = -1;
    saveLayout(layout);
  };

  const input = scene.input;
  const unsubscribe = () => {
    input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
    input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
    input.off(Phaser.Input.Events.POINTER_UP, onUp);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
  };
  input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
  input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  input.on(Phaser.Input.Events.POINTER_UP, onUp);
  input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

  function close(): void {
    saveLayout(layout);
    unsubscribe();
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    // Без таймеров: на паузе время сцены стоит.
    parts.forEach((p) => p.destroy());
    onClose();
  }

  redraw();
}
