import Phaser from 'phaser';
import { DEPTH, FONT } from './constants';
import { sfx } from './sfx';
import type { Choice } from './upgrades';

const CARD_W = 230;
const CARD_H = 270;
const CARD_GAP = 32;
/** Защита от случайного выбора зажатым пробелом. */
const INPUT_DELAY_MS = 450;

/**
 * Экран выбора 1 из 3. Показывается поверх игры; игра на это время стоит.
 */
export function showChoice<T extends string>(
  scene: Phaser.Scene,
  title: string,
  choices: Choice<T>[],
  onPick: (choice: Choice<T>) => void,
): void {
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <O extends Phaser.GameObjects.GameObject>(o: O): O => {
    parts.push(o);
    return o;
  };

  const { width, height } = scene.scale;
  const dim = keep(scene.add.rectangle(width / 2, height / 2, width, height, 0x140a20, 0.72));
  dim.setScrollFactor(0).setDepth(DEPTH.modal).setAlpha(0);
  scene.tweens.add({ targets: dim, alpha: 1, duration: 200 });

  const header = keep(
    scene.add.text(width / 2, 92, title, {
      fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: '#fff3c4', stroke: '#1a1020', strokeThickness: 6,
    }),
  );
  header.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modal + 2).setScale(0.6);
  scene.tweens.add({ targets: header, scale: 1, duration: 380, ease: 'Back.Out' });

  const startX = width / 2 - (choices.length - 1) * (CARD_W + CARD_GAP) / 2;
  const cards = choices.map((choice, i) => buildCard(scene, choice, startX + i * (CARD_W + CARD_GAP), keep, i));

  let selected = -1;
  let done = false;
  const openedAt = scene.time.now;

  const highlight = (index: number) => {
    if (index === selected) return;
    selected = index;
    cards.forEach((card, i) => card.setHover(i === index));
    sfx.select();
  };

  const pick = (index: number) => {
    if (done || scene.time.now - openedAt < INPUT_DELAY_MS) return;
    done = true;
    sfx.pick();
    scene.input.keyboard?.off('keydown', onKey);
    cards.forEach((card, i) => card.leave(i === index));
    scene.tweens.add({
      targets: [dim, header],
      alpha: 0,
      delay: 250,
      duration: 220,
      onComplete: () => {
        parts.forEach((p) => p.destroy());
        onPick(choices[index]);
      },
    });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const n = Number(event.key);
    if (n >= 1 && n <= choices.length) return pick(n - 1);
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') highlight(Math.max(0, selected - 1));
    if (event.code === 'ArrowRight' || event.code === 'KeyD') highlight(Math.min(choices.length - 1, selected + 1));
    if ((event.code === 'Space' || event.code === 'Enter') && selected >= 0) pick(selected);
  };
  scene.input.keyboard?.on('keydown', onKey);

  cards.forEach((card, i) => {
    card.zone.on('pointerover', () => highlight(i));
    card.zone.on('pointerdown', () => pick(i));
  });
}

interface Card {
  zone: Phaser.GameObjects.Zone;
  setHover(on: boolean): void;
  leave(chosen: boolean): void;
}

function buildCard<T extends string>(
  scene: Phaser.Scene,
  choice: Choice<T>,
  x: number,
  keep: <O extends Phaser.GameObjects.GameObject>(o: O) => O,
  index: number,
): Card {
  const y = scene.scale.height / 2 + 30;
  const bg = keep(scene.add.graphics());
  const draw = (hover: boolean) => {
    bg.clear();
    bg.fillStyle(0x000000, 0.35).fillRoundedRect(-CARD_W / 2 + 6, -CARD_H / 2 + 10, CARD_W, CARD_H, 22);
    bg.fillStyle(hover ? 0xfffaf0 : 0xf3ead6, 1).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
    bg.fillStyle(choice.color, 1).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, 104, { tl: 22, tr: 22, bl: 0, br: 0 });
    bg.fillStyle(0xffffff, 0.25).fillRoundedRect(-CARD_W / 2 + 10, -CARD_H / 2 + 8, CARD_W - 20, 16, 8);
    if (hover) bg.lineStyle(5, 0xffffff, 1).strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
  };
  draw(false);

  const icon = keep(scene.add.text(0, -CARD_H / 2 + 52, choice.icon, {
    fontFamily: FONT, fontSize: '52px', fontStyle: 'bold', color: '#ffffff', stroke: '#1a1020', strokeThickness: 6,
  })).setOrigin(0.5);
  const title = keep(scene.add.text(0, 2, choice.title, {
    fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#2a1a30', align: 'center', wordWrap: { width: CARD_W - 24 },
  })).setOrigin(0.5);
  const desc = keep(scene.add.text(0, 70, choice.desc, {
    fontFamily: FONT, fontSize: '16px', color: '#5a4a5a', align: 'center', wordWrap: { width: CARD_W - 32 },
  })).setOrigin(0.5);
  const key = keep(scene.add.text(0, CARD_H / 2 - 22, `${index + 1}`, {
    fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#a89a90',
  })).setOrigin(0.5);

  const items = [bg, icon, title, desc, key];
  const offsets = items.map((o) => o.y);
  const holder = { x, y: y + 60, scale: 0.6, alpha: 0 };
  const sync = () => {
    items.forEach((o, i) => {
      o.setPosition(holder.x, holder.y + offsets[i] * holder.scale);
      o.setScale(holder.scale).setAlpha(holder.alpha);
    });
  };
  items.forEach((o) => o.setScrollFactor(0).setDepth(DEPTH.modal + 1));
  sync();
  scene.tweens.add({ targets: holder, y, scale: 1, alpha: 1, duration: 420, delay: 120 + index * 90, ease: 'Back.Out', onUpdate: sync });

  const zone = keep(scene.add.zone(x, y, CARD_W, CARD_H).setScrollFactor(0).setDepth(DEPTH.modal + 3));
  zone.setInteractive({ useHandCursor: true });

  return {
    zone,
    setHover(on: boolean) {
      draw(on);
      scene.tweens.add({ targets: holder, y: on ? y - 12 : y, scale: on ? 1.05 : 1, duration: 140, ease: 'Quad.Out', onUpdate: sync });
    },
    leave(chosen: boolean) {
      zone.disableInteractive();
      scene.tweens.add({
        targets: holder,
        y: chosen ? y - 40 : y + 80,
        scale: chosen ? 1.15 : 0.8,
        alpha: 0,
        duration: chosen ? 420 : 220,
        ease: 'Quad.In',
        onUpdate: sync,
      });
    },
  };
}
