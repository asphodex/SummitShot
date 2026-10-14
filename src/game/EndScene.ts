import Phaser from 'phaser';
import { DEPTH, FONT, GAME_HEIGHT, GAME_TITLE, GAME_WIDTH, LEVELS_PER_SEASON } from './constants';

import type { EnemyKind } from './season';
import { getSeason } from './season';
import { sfx } from './sfx';
import { createCommonTextures } from './textures';
import { ABILITIES, UPGRADES, newRun, type RunState } from './upgrades';

const ENEMY_NAMES: Record<EnemyKind, string> = {
  crab: 'Краб', spitter: 'Плевун', bat: 'Летучая мышь', turtle: 'Черепаха', charger: 'Горный козёл',
  mole: 'Крот', shooter: 'Скорпион', bomber: 'Жук-бомба', blob: 'Лава-слизень', turret: 'Тотем',
  gnat: 'Мошкара', healer: 'Шаман', sniper: 'Снайпер',
};

const TABS = ['Итоги', 'Враги', 'Билд'];
const PANEL_TOP = 200;
const PANEL_H = 330;
const PANEL_W = 820;

type Fixed = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;

/**
 * Финальный экран после спасения на вертолёте: подробная статистика забега
 * по вкладкам и кнопка "Поделиться" (скриншот).
 */
export class EndScene extends Phaser.Scene {
  private run!: RunState;
  private tab = 0;
  private content: Phaser.GameObjects.GameObject[] = [];
  private tabButtons: Phaser.GameObjects.Text[] = [];
  private uiButtons: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('EndScene');
  }

  init(data: { run: RunState }): void {
    this.run = data.run;
    this.tab = 0;
    this.content = [];
    this.tabButtons = [];
    this.uiButtons = [];
  }

  create(): void {

    // Окно изменило размер — пересобираем экран под новые пропорции.
    const onResize = () => this.scene.restart();
    this.scale.once(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    createCommonTextures(this);
    this.createBackdrop();
    this.cameras.main.fadeIn(900, 255, 246, 225);

    const season = getSeason(this.run.season);
    const title = this.add.text(this.scale.width / 2, 58, 'ВЕРШИНА ПОКОРЕНА!', {
      fontFamily: FONT, fontSize: '50px', fontStyle: 'bold', color: '#fff6dc', stroke: '#1a1020', strokeThickness: 9,
    }).setOrigin(0.5).setScale(0.5).setDepth(DEPTH.hud);
    this.tweens.add({ targets: title, scale: 1, duration: 700, ease: 'Back.Out' });
    this.add.text(this.scale.width / 2, 110, `Сезон «${season.name}» · ${LEVELS_PER_SEASON}/${LEVELS_PER_SEASON} уровней · герой спасён`, {
      fontFamily: FONT, fontSize: '19px', fontStyle: 'bold', color: '#ffd8a0', stroke: '#1a1020', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    TABS.forEach((name, i) => {
      const t = this.add.text(this.scale.width / 2 + (i - 1) * 150, 160, name, {
        fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#1a1020', padding: { x: 18, y: 7 },
      }).setOrigin(0.5).setDepth(DEPTH.hud).setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => this.showTab(i));
      this.tabButtons.push(t);
    });

    this.uiButtons = [
      this.button(this.scale.width / 2 - 220, 'Поделиться', '#7fd8ff', () => this.share()),
      this.button(this.scale.width / 2, 'Новый сезон', '#ffd23f', () => this.scene.start('GameScene', { run: newRun(this.run.season + 1) })),
      this.button(this.scale.width / 2 + 220, 'В меню', '#f3ead6', () => this.scene.start('MenuScene')),
    ];
    this.add.text(16, this.scale.height - 22, GAME_TITLE, {
      fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffffff', stroke: '#1a1020', strokeThickness: 3,
    }).setDepth(DEPTH.hud).setAlpha(0.8);

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) this.showTab(n - 1);
      if (e.code === 'ArrowLeft') this.showTab((this.tab + TABS.length - 1) % TABS.length);
      if (e.code === 'ArrowRight') this.showTab((this.tab + 1) % TABS.length);
    });
    this.showTab(0);
  }

  // --- Фон: рассвет над вулканом и улетающий вертолёт ----------------------------------

  private createBackdrop(): void {
    if (!this.textures.exists('end-sky')) {
      const tex = this.textures.createCanvas('end-sky', GAME_WIDTH, GAME_HEIGHT);
      if (tex) {
        const ctx = tex.getContext();
        const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
        g.addColorStop(0, '#2a2a6a');
        g.addColorStop(0.45, '#c86a8a');
        g.addColorStop(0.75, '#ffb070');
        g.addColorStop(1, '#ffe0a0');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        // Дальние горы и вулкан.
        ctx.fillStyle = '#7a4a6a';
        ctx.beginPath();
        ctx.moveTo(0, 520);
        for (let x = 0; x <= GAME_WIDTH; x += 80) ctx.lineTo(x, 470 + Math.sin(x * 0.02) * 40);
        ctx.lineTo(GAME_WIDTH, GAME_HEIGHT);
        ctx.lineTo(0, GAME_HEIGHT);
        ctx.fill();
        ctx.fillStyle = '#3a2438';
        ctx.beginPath();
        ctx.moveTo(180, GAME_HEIGHT);
        ctx.lineTo(420, 420);
        ctx.lineTo(540, 420);
        ctx.lineTo(800, GAME_HEIGHT);
        ctx.fill();
        ctx.fillStyle = '#ff6a2b';
        ctx.fillRect(420, 416, 120, 6);
        tex.refresh();
      }
    }
    this.add.image(0, 0, 'end-sky').setOrigin(0).setDisplaySize(this.scale.width, this.scale.height);

    // Небо растянуто на экран — дым ставим над жерлом с тем же масштабом.
    const sx = this.scale.width / GAME_WIDTH;
    const sy = this.scale.height / GAME_HEIGHT;
    const smoke = this.add.particles(0, 0, 'soft', {
      x: { min: 440 * sx, max: 520 * sx }, y: 412 * sy, lifespan: 5000, speedY: { min: -40, max: -20 }, speedX: { min: -5, max: 15 },
      scale: { start: 1, end: 4 }, alpha: { start: 0.35, end: 0 }, tint: 0x5a3a4a, frequency: 260,
    });
    smoke.setDepth(1);

    for (let i = 0; i < 5; i++) {
      const cloud = this.add.image(Phaser.Math.Between(0, this.scale.width), Phaser.Math.Between(150, 380), 'soft')
        .setScale(Phaser.Math.FloatBetween(4, 7), Phaser.Math.FloatBetween(1.2, 2)).setAlpha(0.35).setDepth(2);
      this.tweens.add({ targets: cloud, x: cloud.x + 200, duration: 20000 + i * 3000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }

    // Вертолёт с героем улетает к горизонту.
    const heli = this.add.image(-120, 150, 'heli').setScale(0.45).setDepth(3);
    const rotor = this.add.image(heli.x, heli.y, 'rotor').setScale(0.45).setAlpha(0.7).setDepth(3);
    this.tweens.add({ targets: heli, x: this.scale.width + 140, y: 120, duration: 16000, repeat: -1 });
    const spin = (_t: number, delta: number) => {
      rotor.setPosition(heli.x - 13, heli.y - 17).setRotation(rotor.rotation + delta * 0.03);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, spin);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, spin));

    this.add.rectangle(this.scale.width / 2, PANEL_TOP + PANEL_H / 2, PANEL_W, PANEL_H, 0x140a20, 0.72).setDepth(DEPTH.world);
  }

  private button(x: number, label: string, color: string, onClick: () => void): Phaser.GameObjects.Text {
    const b = this.add.text(x, this.scale.height - 58, label, {
      fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#1a1020', backgroundColor: color, padding: { x: 22, y: 10 },
    }).setOrigin(0.5).setDepth(DEPTH.hud).setInteractive({ useHandCursor: true });
    b.on('pointerover', () => { b.setScale(1.06); sfx.select(); });
    b.on('pointerout', () => b.setScale(1));
    b.on('pointerdown', () => { sfx.pick(); onClick(); });
    return b;
  }

  // --- Вкладки ---------------------------------------------------------------------

  private showTab(index: number): void {
    this.tab = index;
    this.content.forEach((o) => o.destroy());
    this.content = [];
    this.tabButtons.forEach((t, i) => t.setBackgroundColor(i === index ? '#ffd23f' : '#f3ead6').setScale(i === index ? 1.08 : 1));
    if (index === 0) this.drawSummary();
    if (index === 1) this.drawEnemies();
    if (index === 2) this.drawBuild();
  }

  private text(x: number, y: number, value: string, size: number, color = '#ffffff', originX = 0): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, value, {
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#1a1020', strokeThickness: 3,
    }).setOrigin(originX, 0).setDepth(DEPTH.hud);
    this.content.push(t);
    return t;
  }

  private keep<O extends Fixed>(o: O): O {
    this.content.push(o);
    return o;
  }

  private drawSummary(): void {
    const s = this.run.stats;
    const accuracy = s.arrows > 0 ? Math.round((s.hits / s.arrows) * 100) : 0;
    const tiles: [string, string][] = [
      ['Время в пути', formatTime(s.time)],
      ['Врагов повержено', `${this.run.kills}`],
      ['Урон нанесён', formatNumber(s.damageDealt)],
      ['Урон получен', formatNumber(s.damageTaken)],
      ['Точность', `${accuracy}%`],
      ['Выпущено стрел', formatNumber(s.arrows)],
      ['Критов', `${s.crits}`],
      ['Перекатов', `${s.rolls}`],
      ['Уклонений', `${s.dodges}`],
      ['Кристаллов опыта', `${s.orbs}`],
    ];
    const cols = 5;
    const w = PANEL_W / cols;
    tiles.forEach(([label, value], i) => {
      const x = this.scale.width / 2 - PANEL_W / 2 + w * (i % cols) + w / 2;
      const y = PANEL_TOP + 24 + Math.floor(i / cols) * 104;
      const value$ = this.text(x, y, value, 34, '#fff3c4', 0.5).setScale(0.6);
      this.tweens.add({ targets: value$, scale: 1, duration: 400, delay: i * 50, ease: 'Back.Out' });
      this.text(x, y + 44, label, 15, '#c8b8c8', 0.5);
    });

    const bosses = getSeason(this.run.season).biomes.map((b) => b.boss.name);
    const times = s.bossTimes.map((t, i) => `${bosses[i] ?? 'Босс'} — ${formatTime(t)}`);
    this.text(this.scale.width / 2, PANEL_TOP + 236, 'Боссы', 18, '#ffd8a0', 0.5);
    this.text(this.scale.width / 2, PANEL_TOP + 264, times.join('   ·   ') || '—', 14, '#e8dccc', 0.5)
      .setWordWrapWidth(PANEL_W - 40).setAlign('center');
  }

  private drawEnemies(): void {
    const kills = Object.entries(this.run.stats.killsByKind)
      .filter(([kind]) => kind !== 'boss')
      .sort((a, b) => b[1] - a[1]) as [EnemyKind, number][];
    if (kills.length === 0) {
      this.text(this.scale.width / 2, PANEL_TOP + 140, 'Никого не победил — пацифист!', 20, '#e8dccc', 0.5);
      return;
    }
    const max = kills[0][1];
    const perCol = 7;
    kills.forEach(([kind, count], i) => {
      const col = Math.floor(i / perCol);
      const x = this.scale.width / 2 - PANEL_W / 2 + 30 + col * (PANEL_W / 2);
      const y = PANEL_TOP + 28 + (i % perCol) * 42;
      if (this.textures.exists(kind)) this.keep(this.add.image(x + 16, y + 10, kind).setScale(0.55).setDepth(DEPTH.hud));
      this.text(x + 44, y, ENEMY_NAMES[kind] ?? kind, 16);
      const barW = 170 * (count / max);
      const bar = this.keep(this.add.rectangle(x + 190, y + 10, barW, 12, 0xffd23f).setOrigin(0, 0.5).setDepth(DEPTH.hud));
      bar.setScale(0, 1);
      this.tweens.add({ targets: bar, scaleX: 1, duration: 500, delay: i * 40, ease: 'Quad.Out' });
      this.text(x + 196 + 170, y, `${count}`, 16, '#fff3c4');
    });
  }

  private drawBuild(): void {
    const counts = new Map<string, number>();
    for (const id of this.run.upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
    this.text(this.scale.width / 2 - PANEL_W / 2 + 30, PANEL_TOP + 18, `Усиления (${this.run.upgrades.length})`, 18, '#ffd8a0');
    let i = 0;
    for (const u of UPGRADES) {
      const n = counts.get(u.id);
      if (!n) continue;
      const x = this.scale.width / 2 - PANEL_W / 2 + 30 + (i % 2) * 190;
      const y = PANEL_TOP + 52 + Math.floor(i / 2) * 32;
      this.text(x, y, `${u.icon} ${u.title}${n > 1 ? ` ×${n}` : ''}`, 15, `#${u.color.toString(16).padStart(6, '0')}`);
      i++;
    }

    const ax = this.scale.width / 2 + 30;
    this.text(ax, PANEL_TOP + 18, `Абилки (${this.run.abilities.length})`, 18, '#ffd8a0');
    this.run.abilities.forEach((id, j) => {
      const a = ABILITIES.find((x) => x.id === id);
      if (!a) return;
      const y = PANEL_TOP + 52 + j * 52;
      this.text(ax, y, `${a.icon} ${a.title}`, 16, `#${a.color.toString(16).padStart(6, '0')}`);
      this.text(ax + 22, y + 22, a.desc, 13, '#c8b8c8');
    });
  }

  // --- Поделиться ------------------------------------------------------------------

  private summaryText(): string {
    const s = this.run.stats;
    return `Я покорил вершину в ${GAME_TITLE}! ${LEVELS_PER_SEASON} уровней за ${formatTime(s.time)}, `
      + `врагов повержено: ${this.run.kills}, уклонений: ${s.dodges}.`;
  }

  /** Скриншот без кнопок: системное "Поделиться", а если его нет — скачивание PNG. */
  private share(): void {
    this.uiButtons.forEach((b) => b.setVisible(false));
    this.game.renderer.snapshot((image) => {
      this.uiButtons.forEach((b) => b.setVisible(true));
      if (!(image instanceof HTMLImageElement)) return;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) void this.shareBlob(blob);
      }, 'image/png');
    });
  }

  private async shareBlob(blob: Blob): Promise<void> {
    const file = new File([blob], 'summit-shot.png', { type: 'image/png' });
    const text = this.summaryText();
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: GAME_TITLE, text });
      } catch {
        // Игрок закрыл окно "Поделиться" — ничего страшного.
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'summit-shot.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try {
      await navigator.clipboard.writeText(text);
      this.toast('Скриншот сохранён, итоги скопированы');
    } catch {
      this.toast('Скриншот сохранён');
    }
  }

  private toast(message: string): void {
    const t = this.add.text(this.scale.width / 2, this.scale.height - 110, message, {
      fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#1a1020', backgroundColor: '#9cffd6', padding: { x: 14, y: 6 },
    }).setOrigin(0.5).setDepth(DEPTH.modal).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: '-=10', duration: 200, yoyo: true, hold: 1800, onComplete: () => t.destroy() });
  }
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? `${m}`.padStart(2, '0') : `${m}`;
  return `${h > 0 ? `${h}:` : ''}${mm}:${`${s}`.padStart(2, '0')}`;
}

function formatNumber(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}
