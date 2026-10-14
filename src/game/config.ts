import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';
import { EndScene } from './EndScene';
import { RENDER_SCALE } from './view';

export function createGame(parent: string): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    // Холст детальнее логического поля — картинка чёткая на больших экранах.
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: '#1a1020',
    // На ноутбуках с двумя видеокартами просим браузер взять мощную.
    render: { powerPreference: 'high-performance' },
    scene: [MenuScene, GameScene, EndScene],
    // Мультитач: джойстик и кнопка рывка/приседа одновременно.
    input: { activePointers: 3 },
    // EXPAND: на широком экране видно больше мира по бокам, без чёрных полос.
    // Базовое поле 960x640 всегда целиком в кадре.
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  return new Phaser.Game(config);
}
