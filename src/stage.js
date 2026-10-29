import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { R0, A_MINOR, traceFieldLine } from './physics.js';

const TWO_PI = Math.PI * 2;
const TRAIL_MAX = 7600;
const TRAIL_LIFE = 4.0;

const FIELD_LINES = 8;
const FIELD_R = 0.7 * A_MINOR;

/** Build a line-segment grid approximating a torus. Physics frame, z up. */
function torusGrid(radius, tube, nTheta, nPhi, seg = 64) {
  const out = [];
  const push = (x, y, z) => out.push(x, y, z);

  // Rings at fixed poloidal angle (circles around the machine axis).
  for (let j = 0; j < nTheta; j++) {
    const theta = (j / nTheta) * TWO_PI;
    const rr = radius + tube * Math.cos(theta);
    const zz = tube * Math.sin(theta);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TWO_PI;
      const b = ((i + 1) / seg) * TWO_PI;
      push(rr * Math.cos(a), rr * Math.sin(a), zz);
      push(rr * Math.cos(b), rr * Math.sin(b), zz);
    }
  }

  // Hoops at fixed toroidal angle (poloidal cross-section outlines).
  for (let i = 0; i < nPhi; i++) {
    const phi = (i / nPhi) * TWO_PI;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TWO_PI;
      const b = ((j + 1) / seg) * TWO_PI;
      const ra = radius + tube * Math.cos(a);
      const rb = radius + tube * Math.cos(b);
      push(ra * cp, ra * sp, tube * Math.sin(a));
      push(rb * cp, rb * sp, tube * Math.sin(b));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return geo;
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.98)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLostTexture() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#ff5d4a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 30, 0, TWO_PI);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(35, 35);
  ctx.lineTo(61, 61);
  ctx.moveTo(61, 35);
  ctx.lineTo(35, 61);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TRAIL_VERT = /* glsl */ `
  attribute float aBirth;
  uniform float uNow;
  uniform float uLife;
  varying float vFade;
  void main() {
    vFade = clamp(1.0 - (uNow - aBirth) / uLife, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float a = pow(vFade, 1.7);
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

export function createStage(canvas) {
  const stageEl = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x07080c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080c);
  scene.fog = new THREE.FogExp2(0x07080c, 0.009);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const viewDirection = new THREE.Vector3(12.8, 11.2, 18.4).normalize();
  camera.position.copy(viewDirection).multiplyScalar(25.2);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 10;
  controls.maxDistance = 80;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;

  let userMovedCamera = false;
  controls.addEventListener('start', () => {
    userMovedCamera = true;
  });

  function fitCamera() {
    if (userMovedCamera) return;
    // Keep the whole 16.4 m torus in frame on narrow or wide stages.
    const distance = Math.max(28.9 / Math.max(camera.aspect, 0.45), 18.8);
    camera.position.copy(viewDirection).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
  }

  // Physics frame (z up) -> three.js frame (y up).
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // ---- vessel ------------------------------------------------------------
  const vesselMat = new THREE.LineBasicMaterial({
    color: 0x64718c,
    transparent: true,
    opacity: 0.19,
    depthWrite: false,
  });
  const vessel = new THREE.LineSegments(torusGrid(R0, A_MINOR, 16, 20, 72), vesselMat);
  world.add(vessel);

  // Faint fresnel rim so the vacuum vessel reads as a volume, not just lines.
  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#7d91bd') },
      uPower: { value: 3.2 },
      uStrength: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(rim, uPower) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(new THREE.TorusGeometry(R0, A_MINOR * 1.004, 40, 160), shellMat);
  world.add(shell);

  // ---- flux surfaces -----------------------------------------------------
  const fluxMat = new THREE.LineBasicMaterial({
    color: 0x6e7d9e,
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
  });
  const fluxGroup = new THREE.Group();
  for (const frac of [0.3, 0.55, 0.8]) {
    const geo = torusGrid(R0, frac * A_MINOR, 4, 8, 56);
    fluxGroup.add(new THREE.LineSegments(geo, fluxMat));
  }
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x8895b3,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
  });
  fluxGroup.add(new THREE.LineSegments(torusGrid(R0, A_MINOR * 0.995, 8, 12, 64), edgeMat));
  world.add(fluxGroup);

  // ---- magnetic axis -----------------------------------------------------
  const axisPts = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * TWO_PI;
    axisPts.push(R0 * Math.cos(a), R0 * Math.sin(a), 0);
  }
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute(axisPts, 3));
  const axis = new THREE.Line(
    axisGeo,
    new THREE.LineBasicMaterial({
      color: 0xe0a86a,
      transparent: true,
      opacity: 0.33,
      depthWrite: false,
    }),
  );
  world.add(axis);

  // ---- field lines -------------------------------------------------------
  const fieldGroup = new THREE.Group();
  const fieldMat = new THREE.LineBasicMaterial({
    color: 0x8ba3d8,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
  });
  world.add(fieldGroup);
  let fieldMode = null;

  function buildFieldLines(poloidal) {
    for (const child of fieldGroup.children) child.geometry.dispose();
    fieldGroup.clear();

    for (let i = 0; i < FIELD_LINES; i++) {
      let pts;
      if (poloidal) {
        const phi = (i / FIELD_LINES) * TWO_PI;
        pts = traceFieldLine(R0 + FIELD_R, 0, phi, true, 2.15, 0.1);
      } else {
        const theta = (i / FIELD_LINES) * TWO_PI;
        pts = traceFieldLine(
          R0 + FIELD_R * Math.cos(theta),
          FIELD_R * Math.sin(theta),
          0,
          false,
          1.08,
          0.1,
        );
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      fieldGroup.add(new THREE.Line(geo, fieldMat));
    }
    fieldMode = poloidal;
  }

  function updateFieldVisibility(B0, enabled) {
    const visibleCount = Math.round(2 + (FIELD_LINES - 2) * Math.min(1, (B0 - 1) / 11));
    fieldGroup.children.forEach((line, i) => {
      line.visible = enabled && i < visibleCount;
    });
  }

  // ---- particles and trails ---------------------------------------------
  const glowTex = makeGlowTexture();
  const lostTex = makeLostTexture();

  const trails = [];
  const sprites = [];
  const lostMarkers = [];

  for (let i = 0; i < 6; i++) {
    const positions = new Float32Array(TRAIL_MAX * 3);
    const births = new Float32Array(TRAIL_MAX);

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const birthAttr = new THREE.BufferAttribute(births, 1);
    birthAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aBirth', birthAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#ff6f86').multiplyScalar(1.45) },
        uNow: { value: 0 },
        uLife: { value: TRAIL_LIFE },
      },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    world.add(line);
    trails.push({ line, mat, count: 0, positions, births, posAttr, birthAttr });

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xff6f86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    sprite.scale.setScalar(1.25);
    world.add(sprite);
    sprites.push(sprite);

    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: lostTex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    marker.scale.setScalar(0.85);
    marker.visible = false;
    world.add(marker);
    lostMarkers.push(marker);
  }

  function resetOrbits(particles, color) {
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      t.count = 0;
      t.line.geometry.setDrawRange(0, 0);
      t.mat.uniforms.uColor.value.set(color).multiplyScalar(1.45);
      t.mat.uniforms.uNow.value = 0;
    }
    for (let i = 0; i < sprites.length; i++) {
      const p = particles[i];
      if (!p) continue;
      sprites[i].position.set(p.x, p.y, p.z);
      sprites[i].material.color.set(color);
      sprites[i].visible = true;
      lostMarkers[i].visible = false;
    }
  }

  function addSample(sampledParticles, now) {
    for (const p of sampledParticles) {
      const t = trails[p.index];
      if (!t) continue;
      if (t.count >= TRAIL_MAX) {
        const keep = Math.floor(TRAIL_MAX * 0.7);
        const drop = TRAIL_MAX - keep;
        t.positions.copyWithin(0, drop * 3, TRAIL_MAX * 3);
        t.births.copyWithin(0, drop, TRAIL_MAX);
        t.count = keep;
      }
      const i3 = t.count * 3;
      t.positions[i3] = p.x;
      t.positions[i3 + 1] = p.y;
      t.positions[i3 + 2] = p.z;
      t.births[t.count] = now;
      t.count += 1;
      t.line.geometry.setDrawRange(0, t.count);
      t.posAttr.needsUpdate = true;
      t.birthAttr.needsUpdate = true;
      t.mat.uniforms.uNow.value = now;
    }
  }

  function updateParticles(particles) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      sprites[i].position.set(p.x, p.y, p.z);
      if (p.lost) {
        sprites[i].visible = false;
        lostMarkers[i].position.set(p.x, p.y, p.z);
        lostMarkers[i].visible = true;
      }
    }
  }

  function setNow(now) {
    for (const t of trails) t.mat.uniforms.uNow.value = now;
  }

  // ---- post processing ---------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.55, 0.52);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = stageEl.clientWidth || 1;
    const h = stageEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(stageEl);
  resize();

  return {
    resetOrbits,
    addSample,
    updateParticles,
    setNow,
    setFieldLines(poloidal, B0, enabled) {
      if (fieldMode !== poloidal) buildFieldLines(poloidal);
      updateFieldVisibility(B0, enabled);
    },
    render() {
      controls.update();
      composer.render();
    },
    dispose() {
      ro.disconnect();
      renderer.dispose();
    },
  };
}
