# Magnetic confinement

An interactive tokamak orbit study. Six charged test particles are integrated
through a prescribed magnetic field and drawn in 3D, with a live poloidal
cross-section of their guiding-centre orbits.

Change the toroidal field strength and watch the gyro-orbits and banana widths
tighten. Switch off the poloidal field and watch every orbit walk into the wall.

Built with Vite and Three.js. The build is fully static and ships with a GitHub
Actions workflow that publishes it to GitHub Pages.

## What you are looking at

- **The vessel** — a 6.2 m major-radius, 2.0 m minor-radius torus, drawn as a
  wireframe with a faint fresnel rim. Nested wireframes mark flux surfaces.
- **Field lines** — traced by integrating `dx/ds = B/|B|` through the same field
  the particles use. With the poloidal field on they are helices; with it off
  they are plain toroidal rings.
- **Particles** — six full Lorentz orbits, integrated with the Boris leapfrog.
  Trails fade over four seconds. Lost particles leave a red marker at the wall.
- **Poloidal section** — the `R–Z` projection of the guiding centres. Trapped
  orbits are inked, passing orbits are slate. The guiding centre is recovered
  from the instantaneous Lorentz offset so the gyro-wiggle does not blur the
  banana shape at this scale.
- **Readout** — characteristic gyroradius, confined count, trapped/passing mix,
  and the local field at the first particle.

Controls: drag to orbit, scroll to zoom, space to pause, `R` to relaunch.

## The model

Coordinates are cylindrical `(R, φ, z)` with `z` up. The magnetic field is a
large-aspect-ratio, circular-flux-surface tokamak field:

```
B_φ     = B₀ R₀ / R
ψ'(r)   = r B₀ / q(r)
B_pol   = -(1/R) ∇ψ × φ̂  =  -(ψ'/R) θ̂
q(r)    = q₀ + (q_a - q₀) (r/a)²
```

with `R₀ = 6.2 m`, `a = 2.0 m`, `q₀ = 1.05`, `q_a = 3.4`. The poloidal field
from the plasma current is what gives the field lines their twist: at the edge
one poloidal turn takes about 3.4 toroidal turns.

Writing the poloidal field as a flux-function gradient keeps `∇·B = 0`. This is
not cosmetic: an approximate `B_θ = r B_φ/(qR)` field has a small divergence,
which leaks canonical angular momentum and makes banana orbits drift over many
transits.

Particles are advanced in Cartesian coordinates with the Boris rotation:

```
v⁻  = v
v'  = v⁻ + v⁻ × (qB Δt / 2m)
v⁺  = v⁻ + (2 / (1 + |t|²)) (v' × t)
x  += v⁺ Δt
```

The timestep resolves the gyration at the strongest field by 40 steps and is
adapted as `B₀` changes. The integration conserves speed to round-off and is
second-order accurate in the field gradient.

Why the field strength matters:

```
ρ = m v⊥ / (|q| B)          gyroradius, ∝ 1/B
```

A weaker field widens every orbit. The trapped-orbit banana width grows with
the gyroradius, so the orbit fills more of the vessel and eventually reaches the
wall. The `Weak 2.4 T` preset shows the widening; `Toroidal only` removes the
poloidal component entirely. In a purely toroidal field the `∇B` and curvature
drifts point vertically on every circuit, so the orbit does not close. The
poloidal component turns the drift into a closed drift orbit — a banana for a
trapped particle, a shifted circle for a passing one.

The alpha particles are born at 3.5 MeV, the ITER-relevant fusion-product
energy. Deuterium defaults to 100 keV. The energy slider ranges over 20–500 keV
for deuterium and 0.5–3.5 MeV for alphas.

## Run locally

Requires Node 20.19+ (Vite 7).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview  # serve the production build
```

## Deploy to GitHub Pages

1. Push the repository to GitHub with `main` as the default branch.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run **Deploy to GitHub Pages** from the Actions tab).

The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
installs dependencies, builds, and deploys `dist/`. Vite's `base` is `./`, so
the same build works at `https://<user>.github.io/<repo>/` without further
configuration.

## Structure

```
index.html              page structure and controls
src/main.js             UI wiring, state, animation loop
src/physics.js          field model, Boris pusher, particle/simulation state
src/stage.js            Three.js scene, vessel, field lines, orbit trails
src/section.js          poloidal cross-section plot
src/style.css           drafting-sheet interface
.github/workflows/      GitHub Pages deployment
```

## Limits

This is a pedagogical test-particle model, not a reactor design tool.

- Circular flux surfaces, large aspect ratio, no Shafranov shift or shaping.
- The field is prescribed, not solved as an MHD equilibrium.
- No collisions, turbulence, electric field, or collective effects.
- Particles are independent test particles; there is no self-consistent
  plasma current, heating, or fusion source.
- The 1–12 T slider and the weak-field preset are thought experiments, not
  operating scenarios. A real device's field, current, and density move
  together.

The trajectories, the `1/R` field variation, the trapped/passing split, and the
banana geometry are all consequences of the field model and the integrator, not
scripted animation.

## References

- J. Wesson, *Tokamaks*, 4th ed., Oxford University Press.
- J. P. Freidberg, *Plasma Physics and Fusion Energy*, Cambridge University Press.
- J. P. Boris, "Relativistic plasma simulation — optimization of a hybrid code,"
  Proc. 4th Conf. Numerical Simulation of Plasmas, 1970.
- C. K. Birdsall and A. B. Langdon, *Plasma Physics via Computer Simulation*.
- [ITER Organization](https://www.iter.org/) — device parameters and fusion basics.
