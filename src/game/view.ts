import Phaser from 'phaser';
import { GAME_HEIGHT, MAX_RENDER_SCALE } from './constants';

/**
 * Чёткая картинка на больших экранах.
 *
 * Вся игра живёт в "логических" координатах (поле 960x640), но холст рисуется
 * в RENDER_SCALE раз детальнее: камера увеличивает мир, текстуры рисуются
 * в повышенном разрешении (см. textures.ts), текст — тоже.
 */
export const RENDER_SCALE = computeRenderScale();

function computeRenderScale(): number {
  // Берём высоту экрана, а не окна: при переходе в полноэкранный режим картинка тоже будет чёткой.
  const screenPx = Math.max(window.screen.height, window.innerHeight) * (window.devicePixelRatio || 1);
  const raw = screenPx / GAME_HEIGHT;
  // Шаг 0.25 — чтобы не получать странные дробные масштабы.
  return Phaser.Math.Clamp(Math.round(raw * 4) / 4, 1, MAX_RENDER_SCALE);
}

/** Ширина видимой области в логических координатах. */
export function viewWidth(scene: Phaser.Scene): number {
  return scene.scale.width / RENDER_SCALE;
}

/** Высота видимой области в логических координатах. */
export function viewHeight(scene: Phaser.Scene): number {
  return scene.scale.height / RENDER_SCALE;
}

/**
 * Вызывать первой строкой в create() каждой сцены:
 * камера показывает мир в логических координатах, а весь текст рендерится чётко.
 */
export function setupView(scene: Phaser.Scene): void {
  scene.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
  const sharpen = (obj: Phaser.GameObjects.GameObject) => {
    if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(RENDER_SCALE);
  };
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, sharpen);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, sharpen));
}
