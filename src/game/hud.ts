import Phaser from 'phaser';
import { DEPTH, FONT, LEVELS_PER_SEASON, ROLL_COST } from './constants';
import { ABILITIES, type RunState } from './upgrades';
import { viewHeight, viewWidth } from './view';

const BAR_X = 46;
const HP_BAR_W = 210;
const STAMINA_BAR_SCALE = 1.4;
const STAMINA_BAR_MAX_W = 330;

export interface HudInfo {
  run: RunState;
  stamina: number;
  progress: number;
  boss: { name: string; hp: number; maxHp: number } | null;
}

/** Интерфейс поверх игры: здоровье, выносливость, опыт, прогресс уровня, босс. */
export class Hud {
  private g: Phaser.GameObjects.Graphics;
  private hpText: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private bossText: Phaser.GameObjects.Text;
  private abilityText: Phaser.GameObjects.Text;
  private shownHp = -1;
  private hpGhost = 1;
  private xpPulse = 0;
  private abilityCount = -1;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, biomeName: string, level: number) {
    this.scene = scene;
    const text = (x: number, y: number, size: number, color = '#ffffff') =>
      scene.add
        .text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#1a1020', strokeThickness: 4 })
        .setScrollFactor(0)
        .setDepth(DEPTH.hud + 1);

    this.g = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.hud);
    scene.add
      .text(16, 12, '♥', { fontFamily: FONT, fontSize: '24px', color: '#ff4f5f', stroke: '#1a1020', strokeThickness: 4 })
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.hpText = text(BAR_X + 8, 14, 13);
    this.levelText = text(0, 12, 18).setOrigin(1, 0);
    this.levelText.setText(level === 0 ? 'Обучение' : `${biomeName} · ${level}/${LEVELS_PER_SEASON}`);
    this.bossText = text(0, 50, 18, '#ffe0a0').setOrigin(0.5, 0).setVisible(false);
    this.abilityText = text(16, 62, 18, '#fff6d0');
  }

  pulseXp(): void {
    this.xpPulse = 1;
  }

  update(info: HudInfo, dt: number): void {
    const { run } = info;
    const g = this.g;
    // Размер экрана берём каждый кадр — окно могли растянуть.
    const width = viewWidth(this.scene);
    const height = viewHeight(this.scene);
    g.clear();
    this.levelText.setX(width - 16);
    this.bossText.setX(width / 2);

    // Здоровье с "призраком" потерянного урона.
    const hpFrac = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);
    this.hpGhost = this.hpGhost > hpFrac ? Math.max(hpFrac, this.hpGhost - dt * 0.6) : hpFrac;
    this.bar(BAR_X, 16, HP_BAR_W, 18, hpFrac, 0xff4f5f, this.hpGhost);
    const hpRounded = Math.ceil(run.hp);
    if (hpRounded !== this.shownHp) {
      this.shownHp = hpRounded;
      this.hpText.setText(`${Math.max(0, hpRounded)}`);
    }

    // Выносливость: желтая, как в PEAK; оранжевая, если на перекат не хватает.
    const staminaWidth = Math.min(run.maxStamina * STAMINA_BAR_SCALE, STAMINA_BAR_MAX_W);
    const staminaColor = info.stamina < ROLL_COST ? 0xff9a3f : 0xf2e04f;
    this.bar(BAR_X, 40, staminaWidth, 11, info.stamina / run.maxStamina, staminaColor);
    const costX = BAR_X + (ROLL_COST / run.maxStamina) * staminaWidth;
    g.fillStyle(0x1a1020, 0.6).fillRect(costX, 40, 2, 11);

    // Опыт внизу.
    this.xpPulse = Math.max(0, this.xpPulse - dt * 3);
    const xpH = 8 + this.xpPulse * 4;
    this.bar(16, height - 14 - xpH / 2, width - 32, xpH, run.xp / Math.max(1, run.xpNeeded), 0x3fe0a8);

    // Прогресс восхождения: путь к флагу.
    const px = width - 196;
    g.fillStyle(0x1a1020, 0.45).fillRoundedRect(px, 40, 180, 8, 4);
    g.fillStyle(0xffffff, 0.9).fillRoundedRect(px, 40, Math.max(8, 180 * info.progress), 8, 4);
    g.fillStyle(0xff5a4a, 1).fillTriangle(px + 180, 30, px + 194, 35, px + 180, 40);
    g.fillStyle(0x4a3a2a, 1).fillRect(px + 178, 30, 3, 20);

    this.drawBoss(info, width);
    this.drawAbilities(run);
  }

  private drawBoss(info: HudInfo, screenW: number): void {
    if (!info.boss) {
      this.bossText.setVisible(false);
      return;
    }
    this.bossText.setVisible(true).setText(info.boss.name);
    const w = 440;
    this.bar(screenW / 2 - w / 2, 76, w, 14, info.boss.hp / info.boss.maxHp, 0xffb03f);
  }

  private drawAbilities(run: RunState): void {
    if (run.abilities.length === this.abilityCount) return;
    this.abilityCount = run.abilities.length;
    const icons = run.abilities.map((id) => ABILITIES.find((a) => a.id === id)?.icon ?? '?');
    this.abilityText.setText(icons.join(' '));
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: number, ghost = 0): void {
    const g = this.g;
    const r = Math.min(h / 2, 6);
    const f = Phaser.Math.Clamp(frac, 0, 1);
    g.fillStyle(0x1a1020, 0.55).fillRoundedRect(x - 3, y - 3, w + 6, h + 6, r + 2);
    if (ghost > f) g.fillStyle(0xffffff, 0.7).fillRoundedRect(x, y, w * ghost, h, r);
    if (f > 0.01) {
      g.fillStyle(color, 1).fillRoundedRect(x, y, Math.max(h, w * f), h, r);
      g.fillStyle(0xffffff, 0.3).fillRoundedRect(x + 2, y + 2, Math.max(0, w * f - 4), h * 0.35, r / 2);
    }
  }
}
