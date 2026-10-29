/**
 * physics.js — tokamak field model and charged-particle orbits.
 *
 * Geometry: a circular torus in cylindrical coordinates (R, phi, z).
 *   major radius   R0 = 6.2 m  (ITER-like)
 *   minor radius   a  = 2.0 m
 *
 * Field model (large-aspect-ratio, circular flux surfaces, no Shafranov shift):
 *   B_phi   = B0 * R0 / R                     toroidal field from the TF coils
 *   psi'(r) = r * B0 / q(r)                   poloidal flux function
 *   B_pol   = -(psi'/R) * theta-hat           divergence-free poloidal field
 *   q(r)    = q0 + (q_edge - q0) * (r/a)^2    parabolic safety-factor profile
 *
 * Writing the poloidal field as (1/R) grad(psi) x phi-hat keeps div B = 0,
 * which matters: an approximate field leaks canonical angular momentum and
 * makes banana orbits drift over many transits. With q_edge ~ 3.4 a field
 * line makes one poloidal turn every ~3.4 toroidal turns.
 *
 * Orbits are integrated with the Boris leapfrog: exact gyro-rotation for a
 * pure magnetic field, second-order accurate in the field gradient.
 */

export const R0 = 6.2;
export const A_MINOR = 2.0;
export const Q0 = 1.05;
export const Q_EDGE = 3.4;

const TWO_PI = Math.PI * 2;
const ELEMENTARY = 1.602176634e-19;

export const SPECIES = {
  deuteron: {
    id: 'deuteron',
    label: 'Deuterium',
    note: 'bulk fuel ion',
    charge: ELEMENTARY,
    mass: 3.3435838e-27,
    color: '#ff6f86',
    eMin: 20e3,
    eMax: 500e3,
    eDefault: 100e3,
    eStep: 5e3,
  },
  alpha: {
    id: 'alpha',
    label: 'Alpha',
    note: '3.5 MeV fusion product',
    charge: 2 * ELEMENTARY,
    mass: 6.6446573e-27,
    color: '#ffd27a',
    eMin: 0.5e6,
    eMax: 3.5e6,
    eDefault: 3.5e6,
    eStep: 25e3,
  },
};

const FIELD_TMP = { x: 0, y: 0, z: 0 };

export function safetyFactor(r) {
  const t = Math.min(Math.abs(r) / A_MINOR, 1);
  return Q0 + (Q_EDGE - Q0) * t * t;
}

/** Magnetic field vector at (x, y, z), in tesla. Writes into `out`. */
export function fieldAt(x, y, z, B0, poloidal, out = FIELD_TMP) {
  const R = Math.hypot(x, y) || 1e-9;
  const cosPhi = x / R;
  const sinPhi = y / R;

  const Bt = (B0 * R0) / R;
  // toroidal direction phi-hat = (-sin, cos, 0)
  out.x = -Bt * sinPhi;
  out.y = Bt * cosPhi;
  out.z = 0;

  if (!poloidal) return out;

  const dR = R - R0;
  const r = Math.hypot(dR, z);
  if (r < 1e-9) return out;

  const q = safetyFactor(r);
  // psi' = r * B0 / q, so B_theta = -(psi'/R); using R0 here (rather than R)
  // is what makes the poloidal field exactly divergence-free.
  const Bp = -(r * Bt) / (q * R0);
  const cosTheta = dR / r;
  const sinTheta = z / r;

  // theta-hat = -sin(theta) * R-hat + cos(theta) * z-hat
  out.x += Bp * -sinTheta * cosPhi;
  out.y += Bp * -sinTheta * sinPhi;
  out.z += Bp * cosTheta;
  return out;
}

export function fieldMagnitude(x, y, z, B0, poloidal) {
  const b = fieldAt(x, y, z, B0, poloidal);
  return Math.hypot(b.x, b.y, b.z);
}

/** Speed (m/s) of a particle with kinetic energy `energyEv` electron-volts. */
export function speedFromEnergy(energyEv, mass) {
  return Math.sqrt((2 * energyEv * ELEMENTARY) / mass);
}

/** Perpendicular gyroradius in metres. */
export function gyroradius(mass, charge, speed, B) {
  return (mass * speed) / (Math.abs(charge) * B);
}

/** Trace a field line in the physics frame (z up). Returns a Float32Array. */
export function traceFieldLine(startR, startZ, phi0, poloidal, turns, ds = 0.09) {
  // Field direction is independent of B0, so trace with a nominal value.
  const B0 = 5.3;
  const length = turns * TWO_PI * R0;
  const count = Math.max(2, Math.floor(length / ds));
  const pts = new Float32Array((count + 1) * 3);

  let x = startR * Math.cos(phi0);
  let y = startR * Math.sin(phi0);
  let z = startZ;

  const b = { x: 0, y: 0, z: 0 };
  const unit = (px, py, pz, out) => {
    fieldAt(px, py, pz, B0, poloidal, b);
    const m = Math.hypot(b.x, b.y, b.z) || 1;
    out[0] = b.x / m;
    out[1] = b.y / m;
    out[2] = b.z / m;
  };

  const k1 = [0, 0, 0];
  const k2 = [0, 0, 0];
  const k3 = [0, 0, 0];
  const k4 = [0, 0, 0];

  pts[0] = x;
  pts[1] = y;
  pts[2] = z;

  for (let i = 0; i < count; i++) {
    unit(x, y, z, k1);
    unit(x + (k1[0] * ds) / 2, y + (k1[1] * ds) / 2, z + (k1[2] * ds) / 2, k2);
    unit(x + (k2[0] * ds) / 2, y + (k2[1] * ds) / 2, z + (k2[2] * ds) / 2, k3);
    unit(x + k3[0] * ds, y + k3[1] * ds, z + k3[2] * ds, k4);

    x += (ds / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (ds / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (ds / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);

    pts[(i + 1) * 3] = x;
    pts[(i + 1) * 3 + 1] = y;
    pts[(i + 1) * 3 + 2] = z;
  }
  return pts;
}

const PITCHES = [0.14, 0.33, 0.5, 0.68, 0.84, 0.96];
const GOLDEN = 2.399963229728653;

export class Particle {
  constructor({ index, species, energyEv, B0, poloidal }) {
    const sp = SPECIES[species];
    this.index = index;
    this.species = sp;
    this.mass = sp.mass;
    this.charge = sp.charge;
    this.energyEv = energyEv;
    this.speed = speedFromEnergy(energyEv, sp.mass);
    this.pitch = PITCHES[index % PITCHES.length];
    this.gyroPhase = index * GOLDEN;

    // Start on the outboard midplane, spread around the torus in phi and
    // across three flux surfaces so the orbits do not all overlap.
    const rFrac = 0.38 + 0.06 * index;
    const r = rFrac * A_MINOR;
    const phi = 0.35 + (index / PITCHES.length) * TWO_PI;
    const R = R0 + r;

    this.x = R * Math.cos(phi);
    this.y = R * Math.sin(phi);
    this.z = 0;

    const b = fieldAt(this.x, this.y, this.z, B0, poloidal);
    const bMag = Math.hypot(b.x, b.y, b.z) || 1;
    const bx = b.x / bMag;
    const by = b.y / bMag;
    const bz = b.z / bMag;

    // Perpendicular basis: e1 = b x z-hat, e2 = b x e1.
    let e1x = by;
    let e1y = -bx;
    let e1z = 0;
    let e1m = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= e1m;
    e1y /= e1m;
    e1z /= e1m;

    const e2x = by * e1z - bz * e1y;
    const e2y = bz * e1x - bx * e1z;
    const e2z = bx * e1y - by * e1x;

    const vPerpFrac = Math.sqrt(Math.max(0, 1 - this.pitch * this.pitch));
    const cp = Math.cos(this.gyroPhase) * vPerpFrac;
    const sp2 = Math.sin(this.gyroPhase) * vPerpFrac;

    this.vx = this.speed * (this.pitch * bx + cp * e1x + sp2 * e2x);
    this.vy = this.speed * (this.pitch * by + cp * e1y + sp2 * e2y);
    this.vz = this.speed * (this.pitch * bz + cp * e1z + sp2 * e2z);

    // Trapped if the parallel velocity vanishes before the inboard field maximum.
    const bInboard = fieldMagnitude(R0 - r, 0, 0, B0, poloidal);
    const bTurn = bMag / Math.max(1e-6, 1 - this.pitch * this.pitch);
    this.orbit = bTurn < bInboard ? 'trapped' : 'passing';

    this.lost = false;
    this.wall = null;
    this.section = [];
    this.lostSampled = false;
  }

  step(dt, B0, poloidal) {
    const b = fieldAt(this.x, this.y, this.z, B0, poloidal);
    const qm = this.charge / this.mass;
    const hx = (qm * b.x * dt) / 2;
    const hy = (qm * b.y * dt) / 2;
    const hz = (qm * b.z * dt) / 2;
    const h2 = hx * hx + hy * hy + hz * hz;
    const s = 2 / (1 + h2);

    const v0x = this.vx;
    const v0y = this.vy;
    const v0z = this.vz;

    // v' = v + v x h
    const px = v0x + (v0y * hz - v0z * hy);
    const py = v0y + (v0z * hx - v0x * hz);
    const pz = v0z + (v0x * hy - v0y * hx);

    // v+ = v + s * (v' x h)
    this.vx = v0x + s * (py * hz - pz * hy);
    this.vy = v0y + s * (pz * hx - px * hz);
    this.vz = v0z + s * (px * hy - py * hx);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  get R() {
    return Math.hypot(this.x, this.y);
  }

  get minorRadius() {
    return Math.hypot(this.R - R0, this.z);
  }

  record(includeSection, B0, poloidal) {
    if (!includeSection) return;

    // Store the guiding centre rather than the raw particle position: the
    // gyro-wiggle is smaller than a pixel in the cross-section and only makes
    // the banana/passing traces fuzzy.
    const b = fieldAt(this.x, this.y, this.z, B0, poloidal);
    const b2 = b.x * b.x + b.y * b.y + b.z * b.z || 1;
    const f = this.mass / (this.charge * b2);
    const cx = this.vy * b.z - this.vz * b.y;
    const cy = this.vz * b.x - this.vx * b.z;
    const cz = this.vx * b.y - this.vy * b.x;
    const gx = this.x + f * cx;
    const gy = this.y + f * cy;
    const gz = this.z + f * cz;

    this.section.push(Math.hypot(gx, gy), gz);
    if (this.section.length > 700 * 2) this.section.splice(0, 140);
  }
}

export class Simulation {
  constructor(params) {
    this.params = { ...params };
    this.particles = [];
    this.time = 0;
    this.dt = 1e-9;
    this.transitTime = 1;
    this.onSample = null;
    this.lostCount = 0;
    this.launch();
  }

  launch() {
    const { species, energyEv, B0, poloidal } = this.params;
    this.particles = [];
    for (let i = 0; i < PITCHES.length; i++) {
      this.particles.push(new Particle({ index: i, species, energyEv, B0, poloidal }));
    }
    this.time = 0;
    this.lostCount = 0;
    this.recomputeTiming();
  }

  recomputeTiming() {
    const sp = SPECIES[this.params.species];
    const bRef = this.params.B0 * 1.5; // near the inboard edge, the strongest field
    const omega = (Math.abs(sp.charge) * bRef) / sp.mass;
    this.dt = TWO_PI / omega / 40;
    const v = speedFromEnergy(this.params.energyEv, sp.mass);
    this.transitTime = (TWO_PI * R0) / v;
  }

  setB0(B0) {
    this.params.B0 = B0;
    this.recomputeTiming();
  }

  advance(realDt, speed) {
    const alive = this.particles.filter((p) => !p.lost);
    if (!alive.length) return { steps: 0, dt: this.dt };

    const dt = this.dt;
    const simPerSecond = (this.transitTime / 1.0) * speed;
    let steps = Math.round((realDt * simPerSecond) / dt);
    steps = Math.max(1, Math.min(1000, steps));
    const every = Math.max(1, Math.floor(steps / 26));

    let sampleIndex = 0;

    for (let i = 0; i < steps; i++) {
      for (const p of alive) {
        if (p.lost) continue;
        p.step(dt, this.params.B0, this.params.poloidal);
        this.checkWall(p);
      }

      if (i % every === 0 || i === steps - 1) {
        const sampled = [];
        for (const p of this.particles) {
          if (!p.lost) {
            p.record(sampleIndex % 8 === 0, this.params.B0, this.params.poloidal);
            sampled.push(p);
          } else if (!p.lostSampled) {
            p.lostSampled = true;
            p.record(true, this.params.B0, this.params.poloidal);
            sampled.push(p);
          }
        }
        sampleIndex += 1;
        if (this.onSample) this.onSample(sampled);
      }

      if (this.lostCount === this.particles.length) break;
    }

    this.time += steps * dt;
    return { steps, dt };
  }

  checkWall(p) {
    const dR = p.R - R0;
    const r = Math.hypot(dR, p.z);
    if (r <= A_MINOR) return;

    // Project the crossing point onto the vessel wall.
    const scale = A_MINOR / r;
    const zz = p.z * scale;
    const rr = R0 + dR * scale;
    const phi = Math.atan2(p.y, p.x);
    p.x = rr * Math.cos(phi);
    p.y = rr * Math.sin(phi);
    p.z = zz;

    p.lost = true;
    p.wall = { R: rr, z: zz };
    p.lostSampled = false;
    this.lostCount += 1;
  }

  get trappedCount() {
    return this.particles.filter((p) => p.orbit === 'trapped').length;
  }

  get passingCount() {
    return this.particles.length - this.trappedCount;
  }
}
