import Phaser from 'phaser';
import { DEPTH, FONT, GAME_HEIGHT, GAME_WIDTH, LEVELS_PER_SEASON } from './constants';
import { getSeason, planLevel } from './season';
import { sfx } from './sfx';
import { biomeKey, createBiomeTextures, createCommonTextures, toColor } from './textures';
import { loadRun, newRun, type RunState } from './upgrades';

const SCROLL_SPEED = 40;

/** Титульный экран: живой фон-восхождение и кнопки "Новый забег" / "Продолжить". */
export class MenuScene extends Phaser.Scene {
  private ground!: Phaser.GameObjects.TileSprite;
  private props: Phaser.GameObjects.Image[] = [];
  private scout!: Phaser.GameObjects.Image;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    const saved = loadRun();
    const season = saved?.season ?? 0;
    const biome = getSeason(season).biomes[0];
    createCommonTextures(this);
    createBiomeTextures(this, biome, 0);

    this.ground = this.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, biomeKey(biome, 'ground')).setOrigin(0);
    this.props = [];
    for (let i = 0; i < 14; i++) {
      const left = i % 2 === 0;
      const tree = Math.random() < 0.5;
      const img = this.add
        .image(left ? Phaser.Math.Between(40, 260) : Phaser.Math.Between(700, 920), Phaser.Math.Between(-60, GAME_HEIGHT), biomeKey(biome, tree ? 'tree' : 'rock1'))
        .setOrigin(0.5, 0.9)
        .setScale(Phaser.Math.FloatBetween(0.7, 1.1));
      this.props.push(img);
    }
    this.scout = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT - 120, 'player').setOrigin(0.5, 0.9).setScale(1.6);
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT - 120, 'shadow').setScale(0.9).setDepth(-1);
    this.add.particles(0, 0, 'soft', {
      x: { min: 0, max: GAME_WIDTH }, y: { min: 0, max: GAME_HEIGHT }, lifespan: 4000,
      speedY: { min: -25, max: -5 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.7, end: 0 },
      blendMode: 'ADD', frequency: 120,
    }).setDepth(DEPTH.overlay);
    this.add.image(0, 0, 'fog').setOrigin(0).setDisplaySize(GAME_WIDTH, 220).setTint(toColor(biome.fog)).setAlpha(0.7).setDepth(DEPTH.overlay);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.overlay);

    const title = this.add.text(GAME_WIDTH / 2, 120, 'ТРОПА ЛУЧНИКА', {
      fontFamily: FONT, fontSize: '68px', fontStyle: 'bold', color: '#fff6dc', stroke: '#1a1020', strokeThickness: 10,
    }).setOrigin(0.5).setScale(0.6).setAlpha(0).setDepth(DEPTH.hud);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 700, ease: 'Back.Out' });
    this.tweens.add({ targets: title, angle: 1.5, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.add.text(GAME_WIDTH / 2, 178, `Сезон ${season + 1} · ${getSeason(season).name}`, {
      fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#ffd8a0', stroke: '#1a1020', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    let y = 268;
    if (saved) {
      const plan = planLevel(saved.season, saved.level, saved.seed);
      this.button(y, `Продолжить · ${plan.biome.name} ${saved.level}/${LEVELS_PER_SEASON}`, () => this.start(saved));
      y += 70;
    }
    this.button(y, 'Новый забег', () => this.start(newRun(season)), !saved);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 44, 'WASD / стрелки — идти     Shift — перекат     C / ПКМ — присесть', {
      fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#ffffff', stroke: '#1a1020', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(DEPTH.hud);
  }

  private button(y: number, label: string, onClick: () => void, primary = true): void {
    const text = this.add.text(GAME_WIDTH / 2, y, label, {
      fontFamily: FONT, fontSize: '26px', fontStyle: 'bold',
      color: '#1a1020', backgroundColor: primary ? '#ffd23f' : '#f3ead6', padding: { x: 26, y: 12 },
    }).setOrigin(0.5).setDepth(DEPTH.hud).setInteractive({ useHandCursor: true });
    text.on('pointerover', () => {
      sfx.unlock();
      sfx.select();
      this.tweens.add({ targets: text, scale: 1.08, duration: 120 });
    });
    text.on('pointerout', () => this.tweens.add({ targets: text, scale: 1, duration: 120 }));
    text.on('pointerdown', onClick);
  }

  private start(run: RunState): void {
    sfx.unlock();
    sfx.pick();
    this.cameras.main.fadeOut(350, 20, 10, 30);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('GameScene', { run }));
  }

  update(time: number, delta: number): void {
    const dy = (SCROLL_SPEED * delta) / 1000;
    this.ground.tilePositionY -= dy;
    for (const p of this.props) {
      p.y += dy;
      if (p.y > GAME_HEIGHT + 120) p.y = -40;
      p.setDepth(p.y);
    }
    this.scout.setDepth(this.scout.y);
    this.scout.y = GAME_HEIGHT - 120 - Math.abs(Math.sin(time / 160)) * 5;
    this.scout.setRotation(Math.sin(time / 160) * 0.06);
  }
}
