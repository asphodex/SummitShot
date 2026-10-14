import './style.css';
import { createGame } from './game/config';
import { loadTuning } from './game/tuning';

// Сначала читаем настройки баланса из public/config.jsonc, затем запускаем игру.
void loadTuning().then(() => createGame('game'));
