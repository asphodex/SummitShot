import Phaser from 'phaser';
import {
  DEPTH,
  FONT,
  TUTORIAL_BEAM_Y,
  TUTORIAL_HOLD_DUMMY_HP,
  TUTORIAL_ROLL_BEAM_Y,
  TUTORIAL_ROLLS,
  TUTORIAL_SHOT_INTERVAL,
  TUTORIAL_SHOT_SPEED,
  TUTORIAL_TASK_WIDTH,
  TUTORIAL_TASK_X,
  TUTORIAL_TASK_Y,
} from './constants';
import type { Enemy } from './enemies';
import { sfx } from './sfx';
import { viewHeight, viewWidth } from './view';

/** Что сценарию обучения нужно от игровой сцены. */
export interface TutorialHost {
  scene: Phaser.Scene;
  playerX(): number;
  playerY(): number;
  spawnDummy(x: number, y: number, hp?: number): Enemy;
  removeDummy(e: Enemy): void;
  fireShot(x: number, y: number, angle: number, speed: number): void;
  skip(): void;
}

type StepId = 'shoot' | 'aim' | 'roll' | 'crouch' | 'rollBeam' | 'exit';

type Step = { id: StepId; text: string };

/** Сначала мышь — её игрок пробует сам; потом пробел, который сам целится в ближайшего врага. */
const DESKTOP_STEPS: Step[] = [
  { id: 'aim', text: 'Наведи мышку на мишень и нажми ЛКМ' },
  { id: 'shoot', text: 'Теперь без мышки: зажми ПРОБЕЛ — лук сам целится и стреляет, пока держишь' },
  { id: 'roll', text: 'Мишень стреляет! Перекатывайся: SHIFT' },
  { id: 'crouch', text: 'Зажми Ctrl, C или ПКМ, чтобы проползти под бревном' },
  { id: 'rollBeam', text: 'Бревно можно проскочить перекатом: разбегись и нажми SHIFT' },
  { id: 'exit', text: 'Отлично! Теперь иди к флагу на вершине' },
];

/** На телефоне лук стреляет сам, поэтому шага с прицелом мышью нет. */
const TOUCH_STEPS: Step[] = [
  { id: 'shoot', text: 'Лук стреляет сам — сбей мишень' },
  { id: 'roll', text: 'Мишень стреляет! Перекатывайся: «Рывок»' },
  { id: 'crouch', text: 'Зажми «Присед» и проползи под бревном' },
  { id: 'rollBeam', text: 'Бревно можно проскочить перекатом: беги к нему и жми «Рывок»' },
  { id: 'exit', text: 'Отлично! Теперь иди к флагу на вершине' },
];

/** Пауза между выполненным шагом и следующей подсказкой. */
const NEXT_STEP_DELAY_MS = 900;
/** Насколько ниже бревна держим героя, пока не дошли до шага с приседом. */
const BEAM_GUARD = 70;

/**
 * Обучение на уровне 0: задание слева по шагам — выстрел мышью, стрельба с зажатым пробелом,
 * перекаты под обстрелом, присед под одним бревном и перекат сквозь другое. Каждый шаг ждёт, пока игрок
 * сделает нужное действие.
 */
export class Tutorial {
  private index = -1;
  private dummy: Enemy | null = null;
  private shotTimer = 0;
  private advancing = false;
  /** Мишень уже выстрелила на шаге с перекатом — перекаты начинают засчитываться. */
  private dummyFired = false;
  private rolls = 0;
  private label: Phaser.GameObjects.Text;
  private prompt: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  private marker: Phaser.GameObjects.Image;
  private steps: Step[];

  constructor(private host: TutorialHost, private touch: boolean) {
    this.steps = touch ? TOUCH_STEPS : DESKTOP_STEPS;
    const scene = host.scene;
    this.label = scene.add.text(TUTORIAL_TASK_X, TUTORIAL_TASK_Y, 'ЗАДАНИЕ', {
      fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffd23f', stroke: '#1a1020', strokeThickness: 4,
    }).setScrollFactor(0).setDepth(DEPTH.hud + 3);
    this.prompt = scene.add.text(TUTORIAL_TASK_X, TUTORIAL_TASK_Y + 18, '', {
      fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#fff6dc',
      stroke: '#1a1020', strokeThickness: 5, backgroundColor: '#1a1020aa', padding: { x: 10, y: 6 },
      wordWrap: { width: TUTORIAL_TASK_WIDTH },
    }).setScrollFactor(0).setDepth(DEPTH.hud + 3);
    this.hint = scene.add.text(0, 0, touch ? 'Пропустить обучение »' : 'Enter — пропустить обучение', {
      fontFamily: FONT, fontSize: touch ? '18px' : '15px', fontStyle: 'bold', color: '#d8c8b8', stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.hud + 3).setAlpha(0.8);
    // Без клавиатуры пропуск — нажатием на подсказку.
    if (touch) this.hint.setPadding(12, 8, 12, 8).setInteractive().on('pointerdown', () => host.skip());
    this.marker = scene.add.image(0, 0, 'ring').setTint(0xffd23f).setVisible(false).setDepth(DEPTH.pool + 1);
    scene.tweens.add({ targets: this.marker, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    this.next();
  }

  private get step(): StepId {
    return this.steps[Math.max(0, this.index)].id;
  }

  /** Самая верхняя точка, куда пускаем героя: за каждое бревно — только на его шаге. */
  minPlayerY(): number {
    if (this.index < this.stepIndex('crouch')) return TUTORIAL_BEAM_Y + BEAM_GUARD;
    if (this.index < this.stepIndex('rollBeam')) return TUTORIAL_ROLL_BEAM_Y + BEAM_GUARD;
    return -Infinity;
  }

  private stepIndex(id: StepId): number {
    return this.steps.findIndex((s) => s.id === id);
  }

  /**
   * На шаге с мышью мишень пробивают только стрелы, выпущенные кликом,
   * на шаге с пробелом — только без мыши, на шаге с перекатом — никакие.
   */
  canHitDummy(byMouse: boolean): boolean {
    if (this.step === 'aim') return byMouse;
    if (this.step === 'shoot') return !byMouse;
    return this.step !== 'roll';
  }

  /** На шаге с пробелом мышь не стреляет — чтобы игрок попробовал именно клавишу. */
  allowsMouseFire(): boolean {
    return this.step !== 'shoot';
  }

  onDummyKilled(e: Enemy): void {
    if (e !== this.dummy) return;
    this.dummy = null;
    if (this.step === 'shoot' || this.step === 'aim') this.complete();
  }

  /** Засчитывается любой перекат, как только мишень начала стрелять. */
  onRoll(): void {
    if (this.step !== 'roll' || !this.dummyFired || this.advancing) return;
    this.rolls += 1;
    this.showRollProgress();
    if (this.rolls >= TUTORIAL_ROLLS) this.complete();
  }

  private showRollProgress(): void {
    this.prompt.setText(`${this.steps[this.index].text}\nПерекатов: ${this.rolls}/${TUTORIAL_ROLLS}`);
  }

  update(dt: number): void {
    const scene = this.host.scene;
    // На телефоне внизу джойстик — подсказку ставим под заданием.
    this.hint.setPosition(viewWidth(scene) / 2, this.touch ? 168 : viewHeight(scene) - 44);

    // Маркер подсвечивает цель шага: мишень или бревно над героем.
    const d = this.dummy;
    const beam = this.beamY();
    if (d && !d.dead) {
      this.marker.setVisible(true).setPosition(d.x, d.y).setScale(0.5);
    } else if (beam !== null && !this.advancing) {
      this.marker.setVisible(true).setPosition(this.host.playerX(), beam).setScale(0.6);
    } else {
      this.marker.setVisible(false);
    }

    if (this.advancing) return;
    if (this.step === 'roll') this.updateShooter(dt);
    if (beam !== null && this.host.playerY() < beam - 24) this.complete();
  }

  /** Бревно, которое нужно пройти на текущем шаге, или null. */
  private beamY(): number | null {
    if (this.step === 'crouch') return TUTORIAL_BEAM_Y;
    if (this.step === 'rollBeam') return TUTORIAL_ROLL_BEAM_Y;
    return null;
  }

  /** Мишень-стрелок бьёт по герою низкими выстрелами — от них нужно перекатиться. */
  private updateShooter(dt: number): void {
    const d = this.dummy;
    if (!d || d.dead) return;
    this.shotTimer -= dt;
    if (this.shotTimer > 0) return;
    this.shotTimer = TUTORIAL_SHOT_INTERVAL;
    this.dummyFired = true;
    d.squash = 0.3;
    const angle = Math.atan2(this.host.playerY() - d.y, this.host.playerX() - d.x);
    this.host.fireShot(d.x, d.y - 10, angle, TUTORIAL_SHOT_SPEED);
  }

  private complete(): void {
    if (this.advancing) return;
    this.advancing = true;
    sfx.pick();
    this.prompt.setText('✓ Получилось!').setColor('#9cffd6');
    const scene = this.host.scene;
    scene.tweens.add({ targets: this.prompt, scale: 1.12, duration: 140, yoyo: true });
    scene.time.delayedCall(NEXT_STEP_DELAY_MS, () => this.next());
  }

  private next(): void {
    this.index = Math.min(this.index + 1, this.steps.length - 1);
    this.advancing = false;
    this.prompt.setText(this.steps[this.index].text).setColor('#fff6dc');

    const px = this.host.playerX();
    const py = this.host.playerY();
    if (this.dummy && !this.dummy.dead) this.host.removeDummy(this.dummy);
    this.dummy = null;

    switch (this.step) {
      case 'shoot':
        // На телефоне лук стреляет сам — зажимать нечего, мишень обычная.
        this.dummy = this.host.spawnDummy(px, py - 230, this.touch ? undefined : TUTORIAL_HOLD_DUMMY_HP);
        break;
      case 'aim':
        // Сбоку от героя — чтобы пришлось прицелиться мышью.
        this.dummy = this.host.spawnDummy(px < 480 ? 760 : 200, py - 150);
        break;
      case 'roll':
        this.dummy = this.host.spawnDummy(480, Math.max(TUTORIAL_BEAM_Y + 110, py - 280));
        this.shotTimer = 1;
        this.dummyFired = false;
        this.rolls = 0;
        this.showRollProgress();
        break;
      default:
        break;
    }
  }
}
