import './style.css';
import {
  Simulation,
  SPECIES,
  fieldAt,
  speedFromEnergy,
  gyroradius,
} from './physics.js';
import { createStage } from './stage.js';
import { SectionPlot } from './section.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  b0: $('#b0'),
  b0Num: $('#b0-num'),
  poloidal: $('#poloidal'),
  energy: $('#energy'),
  energyNum: $('#energy-num'),
  energyUnit: $('#energy-unit'),
  energyMin: $('#energy-scale span:first-child'),
  energyMax: $('#energy-scale span:last-child'),
  speciesNote: $('#species-note'),
  rhoNum: $('#rho-num'),
  rhoUnit: $('#rho-unit'),
  bLocal: $('#b-local-num'),
  mix: $('#mix'),
  confined: $('#confined'),
  observation: $('#observation'),
  observationMobile: $('#observation-mobile'),
  pause: $('#pause'),
  relaunch: $('#relaunch'),
  speed: $('#speed'),
  dt: $('#dt'),
  steps: $('#steps'),
};

const stage = createStage($('#scene'));
const section = new SectionPlot($('#section'));

const sim = new Simulation({
  species: 'alpha',
  energyEv: 3.5e6,
  B0: 5.3,
  poloidal: true,
});

const ui = {
  paused: false,
  speed: 1,
};

const SPEEDS = [1, 2, 4, 8];
let visualNow = 0;
let lastSteps = 0;

const PRESETS = {
  iter: { B0: 5.3, poloidal: true, species: 'alpha', energyEv: 3.5e6 },
  weak: { B0: 2.4, poloidal: true, species: 'alpha', energyEv: 3.5e6 },
  toroidal: { B0: 5.3, poloidal: false, species: 'alpha', energyEv: 3.5e6 },
};

function setText(el, value) {
  if (el) el.textContent = value;
}

function formatRho(mm) {
  if (mm >= 1000) return [(mm / 1000).toFixed(2), 'm'];
  if (mm >= 100) return [(mm / 10).toFixed(1), 'cm'];
  if (mm < 10) return [mm.toFixed(1), 'mm'];
  return [mm.toFixed(0), 'mm'];
}

function formatEnergy(ev) {
  if (ev >= 1e6) return [(ev / 1e6).toFixed(2), 'MeV'];
  return [(ev / 1e3).toFixed(0), 'keV'];
}

function updateFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const val = Number(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty('--p', `${pct.toFixed(2)}%`);
}

function currentRhoMm() {
  const p = sim.params;
  const sp = SPECIES[p.species];
  const v = speedFromEnergy(p.energyEv, sp.mass);
  return gyroradius(sp.mass, sp.charge, v, p.B0) * 1000;
}

function syncControls() {
  const p = sim.params;
  const sp = SPECIES[p.species];

  els.b0.value = String(p.B0);
  setText(els.b0Num, p.B0.toFixed(1));
  updateFill(els.b0);

  els.energy.min = String(sp.eMin / 1e3);
  els.energy.max = String(sp.eMax / 1e3);
  els.energy.step = String(sp.eStep / 1e3);
  els.energy.value = String(p.energyEv / 1e3);
  const [eNum, eUnit] = formatEnergy(p.energyEv);
  setText(els.energyNum, eNum);
  setText(els.energyUnit, eUnit);
  updateFill(els.energy);

  const minUnit = sp.eMin >= 1e6 ? (sp.eMin / 1e6).toFixed(1) : String(Math.round(sp.eMin / 1e3));
  const maxUnit =
    sp.eMax >= 1e6 ? `${(sp.eMax / 1e6).toFixed(1)} MeV` : `${Math.round(sp.eMax / 1e3)} keV`;
  setText(els.energyMin, minUnit);
  setText(els.energyMax, maxUnit);

  els.poloidal.setAttribute('aria-checked', String(p.poloidal));

  document.querySelectorAll('[data-species]').forEach((btn) => {
    const active = btn.dataset.species === p.species;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  setText(
    els.speciesNote,
    p.species === 'alpha'
      ? "Fusion-born helium nucleus. Alpha heating is the plasma's main self-heating channel."
      : 'Bulk fuel ion. In a D–T plasma it carries most of the thermal energy.',
  );
}

function markPreset(name) {
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    const active = btn.dataset.preset === name;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function updateReadout() {
  const p = sim.params;
  const sp = SPECIES[p.species];
  const v = speedFromEnergy(p.energyEv, sp.mass);
  const [rhoNum, rhoUnit] = formatRho(gyroradius(sp.mass, sp.charge, v, p.B0) * 1000);
  setText(els.rhoNum, rhoNum);
  setText(els.rhoUnit, rhoUnit);

  const p0 = sim.particles[0];
  const b = fieldAt(p0.x, p0.y, p0.z, p.B0, p.poloidal);
  setText(els.bLocal, Math.hypot(b.x, b.y, b.z).toFixed(2));
  setText(els.mix, `${sim.trappedCount} / ${sim.passingCount}`);

  const confined = 6 - sim.lostCount;
  setText(els.confined, `${confined} / 6`);
  els.confined.classList.toggle('is-alert', confined < 6);
  els.confined.setAttribute(
    'aria-label',
    confined === 6 ? 'All six particles confined' : `${confined} of six particles confined`,
  );
}

function updateCopy() {
  const p = sim.params;
  const lost = sim.lostCount;
  const B = p.B0;
  const [rhoNum, rhoUnit] = formatRho(currentRhoMm());
  const rho = `${rhoNum} ${rhoUnit}`;

  let text;

  if (!p.poloidal) {
    text =
      `Toroidal field alone. The field lines are plain rings, so the upward curvature and gradient drifts ` +
      `add up on every circuit and the orbits march into the top wall.` +
      (lost ? ` ${lost} of 6 have already struck it.` : '') +
      ` The poloidal field from the plasma current is what closes these orbits.`;
  } else if (lost > 0) {
    text =
      `${lost} of the six orbits have reached the wall at ${B.toFixed(1)} T. As the field weakens, ` +
      `the gyroradius grows and the banana orbits widen until they cross the last flux surface. ` +
      `Raise the field, or relaunch, to recover them.`;
  } else if (B < 3.2) {
    text =
      `At ${B.toFixed(1)} T the gyroradius is ${rho}, ${(5.3 / B).toFixed(1)}× its value at the ` +
      `ITER field. The banana orbits widen with it, so each orbit samples more of the 1/R field ` +
      `variation. The field still closes the orbits, but the margin at the wall is thinner.`;
  } else {
    text =
      `The field lines are helices. Each particle spirals along one while drifting across it; the ` +
      `poloidal twist turns that drift into a closed orbit. ${sim.trappedCount} of the six are trapped ` +
      `on the low-field side and trace bananas; the other ${sim.passingCount} circulate. In the inset, ` +
      `the traces follow guiding centres: trapped orbits are ink, passing orbits slate.`;
  }

  els.observation.textContent = text;
  if (els.observationMobile) els.observationMobile.textContent = text;
}

function relaunch() {
  sim.launch();
  const color = SPECIES[sim.params.species].color;
  stage.resetOrbits(sim.particles, color);
  section.setParticles(sim.particles, color);
  lastSteps = 0;
  updateReadout();
  updateCopy();
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;

  sim.params.species = preset.species;
  sim.params.energyEv = preset.energyEv;
  sim.params.poloidal = preset.poloidal;
  sim.setB0(preset.B0);
  syncControls();
  stage.setFieldLines(sim.params.poloidal, sim.params.B0, true);
  relaunch();
  markPreset(name);
}

/* ---------------------------------------------------------------- events */

els.b0.addEventListener('input', () => {
  const B0 = Number(els.b0.value);
  sim.setB0(B0);
  setText(els.b0Num, B0.toFixed(1));
  updateFill(els.b0);
  stage.setFieldLines(sim.params.poloidal, B0, true);
  markPreset(null);
  updateReadout();
  updateCopy();
});

els.poloidal.addEventListener('click', () => {
  sim.params.poloidal = !sim.params.poloidal;
  els.poloidal.setAttribute('aria-checked', String(sim.params.poloidal));
  stage.setFieldLines(sim.params.poloidal, sim.params.B0, true);
  relaunch();
  markPreset(null);
});

els.energy.addEventListener('input', () => {
  sim.params.energyEv = Number(els.energy.value) * 1e3;
  const [num, unit] = formatEnergy(sim.params.energyEv);
  setText(els.energyNum, num);
  setText(els.energyUnit, unit);
  updateFill(els.energy);
  markPreset(null);
  updateReadout();
  updateCopy();
});

els.energy.addEventListener('change', () => {
  relaunch();
  markPreset(null);
});

document.querySelectorAll('[data-species]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.species;
    if (id === sim.params.species) return;
    sim.params.species = id;
    sim.params.energyEv = SPECIES[id].eDefault;
    syncControls();
    relaunch();
    markPreset(null);
  });
});

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

function togglePause() {
  ui.paused = !ui.paused;
  els.pause.textContent = ui.paused ? 'Resume' : 'Pause';
  els.pause.setAttribute('aria-pressed', String(ui.paused));
}

els.pause.addEventListener('click', togglePause);

els.relaunch.addEventListener('click', () => {
  relaunch();
});

els.speed.addEventListener('click', () => {
  const idx = SPEEDS.indexOf(ui.speed);
  ui.speed = SPEEDS[(idx + 1) % SPEEDS.length];
  els.speed.textContent = `${ui.speed}×`;
  els.speed.setAttribute('aria-label', `Playback speed ${ui.speed} times`);
});

window.addEventListener('keydown', (event) => {
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePause();
  } else if (event.key === 'r' || event.key === 'R') {
    relaunch();
  }
});

/* ------------------------------------------------------------------ loop */

let last = performance.now();
let lastReadout = 0;
let lastLost = -1;

sim.onSample = (sampled) => stage.addSample(sampled, visualNow);

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (!ui.paused) {
    visualNow += dt;
    stage.setNow(visualNow);
    const info = sim.advance(dt, ui.speed);
    lastSteps = info.steps;
  }

  stage.updateParticles(sim.particles);
  stage.render();
  section.draw();

  if (now - lastReadout > 160) {
    lastReadout = now;
    updateReadout();
    setText(els.steps, String(ui.paused ? 0 : lastSteps).padStart(3, '0'));
    setText(els.dt, (sim.dt * 1e9).toFixed(2));
    if (sim.lostCount !== lastLost) {
      lastLost = sim.lostCount;
      updateCopy();
    }
  }

  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------- start */

syncControls();
stage.setFieldLines(sim.params.poloidal, sim.params.B0, true);
relaunch();
markPreset('iter');

requestAnimationFrame(loop);
