/**
 * Короткие синтезированные звуки на WebAudio — без аудиофайлов.
 */

const MASTER_VOLUME = 0.32;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /** Браузер разрешает звук только после действия игрока. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    volume: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFrom: number, filterTo: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrom, t);
    filter.frequency.exponentialRampToValueAtTime(filterTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  private jitter(): number {
    return 0.92 + Math.random() * 0.16;
  }

  private lastPlayed = new Map<string, number>();

  /**
   * Не даёт одному звуку играть чаще, чем раз в minGapMs: в бою десятки попаданий
   * за секунду, и каждый звук — это новые аудиоузлы. На слух разницы нет.
   */
  private throttled(name: string, minGapMs: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < minGapMs) return true;
    this.lastPlayed.set(name, now);
    return false;
  }

  shoot(): void {
    if (this.throttled('shoot', 40)) return;
    const j = this.jitter();
    this.tone('triangle', 620 * j, 180 * j, 0.09, 0.25);
    this.noise(0.06, 0.12, 3000, 1200);
  }

  hit(): void {
    if (this.throttled('hit', 35)) return;
    this.noise(0.07, 0.3, 1600 * this.jitter(), 400);
    this.tone('square', 220 * this.jitter(), 90, 0.06, 0.08);
  }

  kill(): void {
    if (this.throttled('kill', 45)) return;
    this.tone('square', 420 * this.jitter(), 60, 0.16, 0.14);
    this.noise(0.14, 0.25, 900, 200);
  }

  /** Короткий звук сбора опыта; тон растёт, если собирать подряд. */
  pickup(streak: number): void {
    const f = 880 * Math.pow(2, Math.min(streak, 12) / 12);
    this.tone('sine', f, f * 1.5, 0.06, 0.16);
  }

  roll(): void {
    this.noise(0.22, 0.22, 500, 2400);
  }

  hurt(): void {
    this.tone('sawtooth', 300, 70, 0.25, 0.2);
    this.noise(0.15, 0.25, 800, 200);
  }

  enemyShot(high: boolean): void {
    if (this.throttled('enemyShot', 60)) return;
    this.tone('sine', high ? 300 : 520, high ? 160 : 260, 0.12, 0.12);
  }

  telegraph(): void {
    if (this.throttled('telegraph', 80)) return;
    this.tone('square', 900, 900, 0.05, 0.05);
  }

  boom(): void {
    if (this.throttled('boom', 60)) return;
    this.noise(0.4, 0.4, 600, 60);
    this.tone('sine', 120, 40, 0.4, 0.3);
  }

  levelUp(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.18, i * 0.07));
  }

  bossRoar(): void {
    this.tone('sawtooth', 90, 55, 0.9, 0.3);
    this.tone('square', 135, 70, 0.9, 0.12);
    this.noise(0.9, 0.2, 300, 120);
  }

  gateOpen(): void {
    [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('sine', f, f, 0.3, 0.16, i * 0.09));
  }

  pick(): void {
    this.tone('triangle', 660, 990, 0.12, 0.2);
  }

  select(): void {
    this.tone('sine', 520, 520, 0.04, 0.08);
  }

  frost(): void {
    this.tone('sine', 1800, 600, 0.3, 0.12);
    this.noise(0.3, 0.12, 5000, 2000);
  }

  /** Стрела отскочила от панциря. */
  block(): void {
    if (this.throttled('block', 60)) return;
    this.tone('square', 1400 * this.jitter(), 900, 0.05, 0.08);
  }

  heal(): void {
    if (this.throttled('heal', 100)) return;
    this.tone('sine', 600, 1200, 0.25, 0.1);
  }

  pause(): void {
    this.tone('triangle', 520, 390, 0.12, 0.15);
  }

  zap(): void {
    if (this.throttled('zap', 60)) return;
    this.noise(0.12, 0.25, 6000, 1500);
    this.tone('sawtooth', 1200, 200, 0.12, 0.1);
  }

  flare(): void {
    this.noise(0.9, 0.2, 800, 4000);
  }

  /** Стрекот винта вертолёта — один "удар" лопасти. */
  chop(): void {
    this.noise(0.05, 0.12, 180, 90);
  }

  victory(): void {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.16, i * 0.11));
  }

  death(): void {
    [400, 300, 220, 140].forEach((f, i) => this.tone('triangle', f, f * 0.9, 0.25, 0.2, i * 0.15));
  }
}

export const sfx = new Sfx();
