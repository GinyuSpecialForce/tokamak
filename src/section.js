import { R0, A_MINOR } from './physics.js';

const TAU = Math.PI * 2;
const INK = '22, 24, 29';
const ALERT = '#b03828';

export class SectionPlot {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.color = '#ffd27a';
    this.size = 240;
    this.dpr = 1;

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssSize = Math.max(80, Math.round(Math.min(rect.width || 240, rect.height || 240)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = cssSize;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
  }

  setParticles(particles, color) {
    this.particles = particles;
    this.color = color;
  }

  draw() {
    const ctx = this.ctx;
    const size = this.size;
    if (!size) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pad = size * 0.045;
    const scale = (size - pad * 2) / (2 * A_MINOR + 0.14);
    const cx = size / 2;
    const cy = size / 2;
    const mx = (R) => cx + (R - R0) * scale;
    const my = (z) => cy - z * scale;

    // paper dot grid
    const step = Math.max(9, size / 22);
    ctx.fillStyle = `rgba(${INK}, 0.075)`;
    for (let x = step * 0.5; x < size; x += step) {
      for (let y = step * 0.5; y < size; y += step) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // flux surfaces and vessel
    for (const frac of [0.32, 0.64, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, A_MINOR * frac * scale, 0, TAU);
      ctx.strokeStyle = `rgba(${INK}, ${frac === 1 ? 0.4 : 0.12})`;
      ctx.lineWidth = frac === 1 ? 1.1 : 0.75;
      ctx.stroke();
    }

    // magnetic axis mark
    ctx.strokeStyle = `rgba(${INK}, 0.32)`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx, cy + 3);
    ctx.stroke();

    // Orbit traces, faded by age. Trapped orbits are drawn in ink, passing
    // orbits in slate, so the two families can be told apart where they overlap.
    for (const p of this.particles) {
      const sec = p.section;
      const n = sec.length / 2;
      if (n < 2) continue;

      const rgb = p.orbit === 'trapped' ? INK : '74, 96, 120';
      const peak = p.orbit === 'trapped' ? 0.82 : 0.46;
      const base = p.orbit === 'trapped' ? 0.12 : 0.06;
      const chunks = 8;
      for (let c = 0; c < chunks; c++) {
        const i0 = Math.floor((c / chunks) * (n - 1));
        const i1 = Math.floor(((c + 1) / chunks) * (n - 1));
        if (i1 <= i0) continue;

        ctx.beginPath();
        ctx.moveTo(mx(sec[i0 * 2]), my(sec[i0 * 2 + 1]));
        for (let i = i0 + 1; i <= i1; i++) {
          ctx.lineTo(mx(sec[i * 2]), my(sec[i * 2 + 1]));
        }
        const t = (c + 1) / chunks;
        ctx.strokeStyle = `rgba(${rgb}, ${(base + (peak - base) * t).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // particle heads
    for (const p of this.particles) {
      if (p.lost) {
        if (!p.wall) continue;
        const x = mx(p.wall.R);
        const y = my(p.wall.z);
        ctx.strokeStyle = ALERT;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
        continue;
      }

      const x = mx(p.R);
      const y = my(p.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU);
      ctx.fillStyle = this.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${INK}, 0.5)`;
      ctx.stroke();
    }
  }
}
