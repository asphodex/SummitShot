import Phaser from 'phaser';
import {
  DEPTH,
  FONT,
  TUTORIAL_BEAM_Y,
  TUTORIAL_SHOT_INTERVAL,
  TUTORIAL_SHOT_SPEED,
} from './constants';
import type { Enemy } from './enemies';
import { sfx } from './sfx';
import { viewHeight, viewWidth } from './view';

/** Что сценарию обучения нужно от игровой сцены. */
export interface TutorialHost {
  scene: Phaser.Scene;
  playerX(): number;
  playerY(): number;
  spawnDummy(x: number, y: number): Enemy;
  removeDummy(e: Enemy): void;
  fireShot(x: number, y: number, angle: number, speed: number): void;
}

type StepId = 'shoot' | 'aim' | 'roll' | 'crouch' | 'exit';

const STEPS: { id: StepId; text: string }[] = [
  { id: 'shoot', text: 'Нажми ПРОБЕЛ, чтобы выстрелить' },
  { id: 'aim', text: 'Наведи мышку на мишень и нажми ЛКМ' },
  { id: 'roll', text: 'Мишень стреляет! Нажми SHIFT и перекатись от выстрела' },
  { id: 'crouch', text: 'Зажми Ctrl, C или ПКМ, чтобы проползти под бревном' },
  { id: 'exit', text: 'Отлично! Теперь иди к флагу на вершине' },
];

/** Пауза между выполненным шагом и следующей подсказкой. */
const NEXT_STEP_DELAY_MS = 900;
/** Насколько ниже бревна держим героя, пока не дошли до шага с приседом. */
const BEAM_GUARD = 70;

/**
 * Обучение на уровне 0: подсказки по шагам — выстрел, прицел мышью,
 * перекат от выстрела и присед под бревном. Каждый шаг ждёт, пока игрок
 * сделает нужное действие.
 */
export class Tutorial {
  private index = -1;
  private dummy: Enemy | null = null;
  private shotTimer = 0;
  private advancing = false;
  private prompt: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  private marker: Phaser.GameObjects.Image;

  constructor(private host: TutorialHost) {
    const scene = host.scene;
    this.prompt = scene.add.text(0, 112, '', {
      fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#fff6dc',
      stroke: '#1a1020', strokeThickness: 6, backgroundColor: '#1a1020aa', padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.hud + 3);
    this.hint = scene.add.text(0, 0, 'Enter — пропустить обучение', {
      fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#d8c8b8', stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.hud + 3).setAlpha(0.8);
    this.marker = scene.add.image(0, 0, 'ring').setTint(0xffd23f).setVisible(false).setDepth(DEPTH.pool + 1);
    scene.tweens.add({ targets: this.marker, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    this.next();
  }

  private get step(): StepId {
    return STEPS[Math.max(0, this.index)].id;
  }

  /** Самая верхняя точка, куда пускаем героя: за бревно — только на шаге с приседом. */
  minPlayerY(): number {
    return this.index < STEPS.findIndex((s) => s.id === 'crouch') ? TUTORIAL_BEAM_Y + BEAM_GUARD : -Infinity;
  }

  /** На шаге с мышью мишень пробивают только стрелы, выпущенные кликом; на шаге с перекатом — никакие. */
  canHitDummy(byMouse: boolean): boolean {
    if (this.step === 'aim') return byMouse;
    return this.step !== 'roll';
  }

  onDummyKilled(e: Enemy): void {
    if (e !== this.dummy) return;
    this.dummy = null;
    if (this.step === 'shoot' || this.step === 'aim') this.complete();
  }

  onRollDodge(): void {
    if (this.step === 'roll') this.complete();
  }

  update(dt: number): void {
    const scene = this.host.scene;
    this.prompt.setX(viewWidth(scene) / 2);
    this.hint.setPosition(viewWidth(scene) / 2, viewHeight(scene) - 44);

    // Маркер подсвечивает цель шага: мишень или середину бревна.
    const d = this.dummy;
    if (d && !d.dead) {
      this.marker.setVisible(true).setPosition(d.x, d.y).setScale(0.5);
    } else if (this.step === 'crouch' && !this.advancing) {
      this.marker.setVisible(true).setPosition(this.host.playerX(), TUTORIAL_BEAM_Y).setScale(0.6);
    } else {
      this.marker.setVisible(false);
    }

    if (this.advancing) return;
    if (this.step === 'roll') this.updateShooter(dt);
    if (this.step === 'crouch' && this.host.playerY() < TUTORIAL_BEAM_Y - 24) this.complete();
  }

  /** Мишень-стрелок бьёт по герою низкими выстрелами — от них нужно перекатиться. */
  private updateShooter(dt: number): void {
    const d = this.dummy;
    if (!d || d.dead) return;
    this.shotTimer -= dt;
    if (this.shotTimer > 0) return;
    this.shotTimer = TUTORIAL_SHOT_INTERVAL;
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
    this.index = Math.min(this.index + 1, STEPS.length - 1);
    this.advancing = false;
    this.prompt.setText(STEPS[this.index].text).setColor('#fff6dc');

    const px = this.host.playerX();
    const py = this.host.playerY();
    if (this.dummy && !this.dummy.dead) this.host.removeDummy(this.dummy);
    this.dummy = null;

    switch (this.step) {
      case 'shoot':
        this.dummy = this.host.spawnDummy(px, py - 230);
        break;
      case 'aim':
        // Сбоку от героя — чтобы пришлось прицелиться мышью.
        this.dummy = this.host.spawnDummy(px < 480 ? 760 : 200, py - 150);
        break;
      case 'roll':
        this.dummy = this.host.spawnDummy(480, Math.max(TUTORIAL_BEAM_Y + 110, py - 280));
        this.shotTimer = 1;
        break;
      default:
        break;
    }
  }
}
