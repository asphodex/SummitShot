import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';
import { EndScene } from './EndScene';

export function createGame(parent: string): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#1a1020',
    // На ноутбуках с двумя видеокартами просим браузер взять мощную.
    render: { powerPreference: 'high-performance' },
    scene: [MenuScene, GameScene, EndScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  return new Phaser.Game(config);
}
