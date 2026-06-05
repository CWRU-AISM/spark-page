import * as THREE from 'three';

// SPARK hero. Four scores are warped onto one smooth closed ribbon loop (a circle in
// XZ with a height undulation, plus per-section twist / bend / lift -- the exact shape
// tuned in the score visualizer). The frame is continuous, so the staff is one ribbon
// with no seams. Hovering a section slides it outward while keeping its bendy shape;
// clicking it unrolls that section flat to the front and plays its real-robot video.

const mount = document.getElementById('hero-canvas');
const rotEl = document.getElementById('hero-rot');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CAT_COL = { grasp: 0x2563eb, move: 0x059669, manipulate: 0xd97706, release: 0xdc2626 };
const STAFF = 0x1a1a1a;
const GRASP = new Set(['grasp_se3', 'pinch']);
const MOVE = new Set(['move_to_kp', 'move_relative']);
const REL = new Set(['release_arm']);
const SUST = new Set(['pour', 'sweep', 'constrained_scrub', 'fold_arch']);
const cat = t => GRASP.has(t) ? 'grasp' : MOVE.has(t) ? 'move' : REL.has(t) ? 'release' : 'manipulate';
const lane = t => GRASP.has(t) ? 1 : MOVE.has(t) ? 2 : REL.has(t) ? 4 : 3;
const noteVal = t => (SUST.has(t) || GRASP.has(t)) ? 'half' : t === 'move_to_kp' ? 'quarter' : (MOVE.has(t) || REL.has(t)) ? 'eighth' : 'quarter';
const SHORT = { move_to_kp: 'move', move_relative: 'move', grasp_se3: 'grasp', pinch: 'pinch', release_arm: 'release', constrained_scrub: 'scrub', fold_arch: 'fold', pour: 'pour', sweep: 'sweep' };

// The four showcase scores (all have real-robot videos). Order = order round the loop.
const SHOW = [
  { label: 'Sweep', thumb: 'sweep.jpg', video: 'real/sweep.mp4', prims: ['move_to_kp', 'grasp_se3', 'sweep', 'release_arm'] },
  { label: 'Pour', thumb: 'mug.jpg', video: 'real/mug.mp4', prims: ['move_to_kp', 'move_relative', 'grasp_se3', 'pour', 'release_arm'] },
  { label: 'Fold', thumb: 'fold_bi.jpg', video: 'real/fold_bi.mp4', prims: ['pinch', 'grasp_se3', 'fold_arch', 'fold_arch', 'release_arm'] },
  { label: 'Sponge', thumb: 'sponge.jpg', video: 'real/sponge.mp4', prims: ['move_to_kp', 'move_relative', 'grasp_se3', 'constrained_scrub', 'release_arm'] },
];
const N = SHOW.length;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
mount.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(4, 6, 9); scene.add(dl);
const world = new THREE.Group(); world.position.y = 2.2; scene.add(world);

// ── Ribbon geometry (ported from the score visualizer, tuned defaults) ───────────
const SL = 5, LG = 0.42, TWO_PI = Math.PI * 2;
const ribR = N * 16 / TWO_PI, ribHWOB = 1.8, ribKW = 2, ribAMP = 2.0, ribLIFT = 1.0;
const RIB_PERIODS = 1, RIB_LIFT_PERIODS = 1;
const secTwist = [0, -0.6, 0, 0.6], secBend = [1, 1, 1, 1], secLift = [1, 1, 1, 1];

function sampleSec(arr, u) {
  u = ((u % 1) + 1) % 1; const n = arr.length, c = u * n - 0.5, i0 = Math.floor(c), f = c - i0;
  const a = arr[((i0 % n) + n) % n], b = arr[(((i0 + 1) % n) + n) % n], w = 0.5 - 0.5 * Math.cos(Math.PI * f);
  return a * (1 - w) + b * w;
}
function ribbonPoint(u) {
  const ang = TWO_PI * (u - 1 / (2 * N));
  return new THREE.Vector3(ribR * Math.sin(ang), ribHWOB * Math.sin(TWO_PI * ribKW * u), ribR * Math.cos(ang));
}
function ribbonFrame(u) {
  u = ((u % 1) + 1) % 1; const du = 0.0015;
  const p = ribbonPoint(u), a = ribbonPoint((u - du + 1) % 1), b = ribbonPoint((u + du) % 1);
  const T = new THREE.Vector3().subVectors(b, a).normalize();
  const U = new THREE.Vector3(0, 1, 0).addScaledVector(T, -T.y).normalize();
  const tw = sampleSec(secTwist, u); if (tw) U.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(T, tw));
  const B = new THREE.Vector3().crossVectors(T, U).normalize();
  return { p, T, U, B };
}
function staffPos(i, tL, line) {
  const u = i / N + tL / N, offY = (line - (SL - 1) / 2) * LG;
  const offZ = ribAMP * sampleSec(secBend, u) * Math.sin(tL * TWO_PI * RIB_PERIODS);
  const offU = ribLIFT * sampleSec(secLift, u) * Math.sin(tL * TWO_PI * RIB_LIFT_PERIODS);
  const f = ribbonFrame(u);
  return f.p.clone().addScaledVector(f.U, offY + offU).addScaledVector(f.B, offZ);
}
const _m = new THREE.Matrix4();
function frameQuat(i, tL) { const f = ribbonFrame(i / N + tL / N); _m.makeBasis(f.T, f.U, f.B); return new THREE.Quaternion().setFromRotationMatrix(_m); }
const secRadial = [];
for (let i = 0; i < N; i++) { const p = ribbonPoint((i + 0.5) / N); secRadial.push(new THREE.Vector3(p.x, 0, p.z).normalize()); }

// flat (unrolled) layout, shown up front when a section is clicked
const FW = 11, YF = 0.0, FZ = 7.0, PULL = 3.2, DROPD = 18;

// ── Notes (matched to the score-visualizer medley: thin staff, small matte heads) ──
function labelTex(text) { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d'); x.font = '600 52px JetBrains Mono, monospace'; x.fillStyle = '#222'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 50); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; return t; }
function flagTex(dir) { const c = document.createElement('canvas'); c.width = 48; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#111'; x.beginPath(); if (dir > 0) { x.moveTo(6, 2); x.bezierCurveTo(46, 16, 40, 46, 16, 78); x.bezierCurveTo(34, 48, 30, 28, 6, 22); } else { x.moveTo(6, 78); x.bezierCurveTo(46, 64, 40, 34, 16, 2); x.bezierCurveTo(34, 32, 30, 52, 6, 58); } x.closePath(); x.fill(); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; return t; }
function makeNote(color, nv, stemDir, labelText, sec) {
  const g = new THREE.Group();
  const hw = 0.20, hh = 0.15, hd = 0.08, open = nv === 'half' || nv === 'whole';
  const hg = new THREE.SphereGeometry(1, 16, 12); hg.scale(hw, hh, hd);
  const headMat = new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.7 });
  const head = new THREE.Mesh(hg, headMat); head.rotation.z = -0.25; head.userData.sec = sec; g.add(head);
  if (open) { const ig = new THREE.SphereGeometry(1, 16, 12); ig.scale(hw * 0.52, hh * 0.52, hd * 1.3); const inner = new THREE.Mesh(ig, new THREE.MeshBasicMaterial({ color: 0xffffff })); inner.rotation.z = -0.25; g.add(inner); }
  if (nv !== 'whole') {
    const sx = stemDir > 0 ? hw * 0.7 : -hw * 0.7;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0x000000 })); stem.position.set(sx, stemDir * 0.35, 0); g.add(stem);
    if (nv === 'eighth') { const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.40), new THREE.MeshBasicMaterial({ map: flagTex(stemDir), transparent: true, side: THREE.DoubleSide, depthTest: false })); fl.position.set(sx + 0.1, stemDir * 0.5, 0.002); g.add(fl); }
  }
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: labelTex(labelText), transparent: true, side: THREE.DoubleSide, depthTest: false }));
  lab.position.set(0, stemDir > 0 ? -0.5 : 0.5, 0); lab.scale.set(0.001, 0.001, 1); g.add(lab);
  return { g, headMat, lab, head };
}

// ── Build the four sections (staff tubes + notes) ─────────────────────────────────
const pieces = [], notes = [];
const NP = 44, TUBE_R = 0.028;
const tubeGeo = pts => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length - 1, TUBE_R, 5, false);
function morphPt(b, pu, f, pull, lay, drop) {
  let x = b.x, y = b.y, z = b.z;
  if (pull > 1e-3) { x = x + (pu.x - x) * pull; y = y + (pu.y - y) * pull; z = z + (pu.z - z) * pull; }
  if (lay > 1e-3) { x = x + (f.x - x) * lay; y = y + (f.y - y) * lay; z = z + (f.z - z) * lay; }
  return new THREE.Vector3(x, y - DROPD * drop, z);
}
for (let i = 0; i < N; i++) {
  const mat = new THREE.MeshBasicMaterial({ color: STAFF, transparent: true, opacity: 0.92 });
  const base = [], pulled = [], flat = [], meshes = [];
  const rad = secRadial[i];
  for (let l = 0; l < SL; l++) {
    const bA = [], puA = [], fA = [];
    for (let j = 0; j < NP; j++) {
      const tL = j / (NP - 1), b = staffPos(i, tL, l);
      bA.push(b); puA.push(b.clone().addScaledVector(rad, PULL));
      fA.push(new THREE.Vector3((tL - 0.5) * FW, (l - (SL - 1) / 2) * LG + YF, FZ));
    }
    base.push(bA); pulled.push(puA); flat.push(fA);
    const mesh = new THREE.Mesh(tubeGeo(bA), mat); mesh.userData.sec = i; world.add(mesh); meshes.push(mesh);
  }
  pieces.push({ i, base, pulled, flat, meshes, mat, lp: 0, ll: 0, ld: 0 });

  // notes
  const prims = SHOW[i].prims, n = prims.length;
  prims.forEach((prim, si) => {
    const tL = 0.16 + 0.68 * (si / Math.max(1, n - 1)), ln2 = lane(prim), sd = ln2 >= 2.5 ? -1 : 1;
    const nb = makeNote(CAT_COL[cat(prim)], noteVal(prim), sd, SHORT[prim] || prim, i); world.add(nb.g);
    notes.push({
      sec: i, g: nb.g, headMat: nb.headMat, lab: nb.lab, head: nb.head,
      base: staffPos(i, tL, ln2), pulled: staffPos(i, tL, ln2).addScaledVector(rad, PULL),
      flat: new THREE.Vector3((tL - 0.5) * FW * 0.9, (ln2 - (SL - 1) / 2) * LG + YF, FZ),
      baseQ: frameQuat(i, tL), scale: 1, labS: 0,
    });
  });
}

// ── Video / thumbnail cards (one per section) ─────────────────────────────────────
const TEX = new THREE.TextureLoader();
const hoverVid = document.createElement('video');
hoverVid.muted = true; hoverVid.loop = true; hoverVid.playsInline = true; hoverVid.preload = 'auto';
hoverVid.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;'; document.body.appendChild(hoverVid);
const vidTex = new THREE.VideoTexture(hoverVid); vidTex.colorSpace = THREE.SRGBColorSpace;
const cards = [];
for (let i = 0; i < N; i++) {
  const CW = 3.0, CH = CW * 9 / 16, uc = (i + 0.5) / N, f = ribbonFrame(uc);
  const card = new THREE.Group();
  card.add(new THREE.Mesh(new THREE.PlaneGeometry(CW + 0.16, CH + 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const photoTex = TEX.load('static/media/thumbs/' + SHOW[i].thumb); photoTex.colorSpace = THREE.SRGBColorSpace;
  const photoMat = new THREE.MeshBasicMaterial({ map: photoTex });
  const photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), photoMat); photoMesh.position.z = 0.01; card.add(photoMesh);
  world.add(card); card.visible = false;
  const top = f.p.clone().addScaledVector(f.U, (SL - 1) / 2 * LG + CH / 2 + 0.5);
  cards.push({ i, card, photoMesh, photoTex, base: top, flat: new THREE.Vector3(0, YF + (SL - 1) / 2 * LG + CH / 2 + 0.7, FZ), scale: 1 });
}

// ── Interaction: hover (3D + menu) pulls out, click flattens + plays video ────────
let hoverSec = -1, selSec = -1, activeVid = -1, closeTimer = 0;
function playVid(k) {
  if (activeVid === k) return;
  if (activeVid >= 0) { cards[activeVid].photoMesh.material.map = cards[activeVid].photoTex; cards[activeVid].photoMesh.material.needsUpdate = true; }
  activeVid = -1; clearTimeout(closeTimer);
  if (k >= 0 && SHOW[k].video) { hoverVid.src = 'static/media/' + SHOW[k].video; const p = hoverVid.play(); if (p) p.catch(() => { }); activeVid = k; cards[k].photoMesh.material.map = vidTex; cards[k].photoMesh.material.needsUpdate = true; }
  else closeTimer = setTimeout(() => hoverVid.pause(), 200);
}
function setHover(k) { if (selSec < 0) hoverSec = k; }
function setSel(k) { selSec = (selSec === k) ? -1 : k; hoverSec = -1; playVid(selSec); }

const raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold = 0.55;
const ndc = new THREE.Vector2();
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1; ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(world.children, true);
  for (const h of hits) { const s = h.object.userData && h.object.userData.sec; if (s != null) return s; }
  return -1;
}

// drag to rotate vs click to select
let yaw = 0.30, pitch = -0.60, dispY = 0.30, dispP = -0.60, dragging = false, moved = 0, lastX = 0, lastY = 0;
mount.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointermove', e => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * 0.006; pitch = Math.min(1.3, Math.max(-1.45, pitch + dy * 0.006));
  } else if (state === 'loop') {
    const k = pick(e); mount.style.cursor = k >= 0 ? 'pointer' : 'grab'; setHover(k);
  }
});
window.addEventListener('pointerup', e => {
  if (dragging && moved < 6 && state === 'loop') { const k = pick(e); if (k >= 0) setSel(k); else if (selSec >= 0) setSel(selSec); }
  dragging = false;
});
document.querySelectorAll('.menu-item').forEach(el => {
  const k = parseInt(el.dataset.task);
  el.addEventListener('mouseenter', () => setHover(k));
  el.addEventListener('mouseleave', () => setHover(-1));
  el.addEventListener('click', () => setSel(k));
});

function resize() { const w = mount.clientWidth, h = mount.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

// ── Animate ───────────────────────────────────────────────────────────────────────
const CAMZ = 21, EZ = 0.12, INTRO = 1.4, DELAY = 0.3;
camera.position.set(0, 1, CAMZ); camera.lookAt(0, 0, 0);
const pull = new Array(N).fill(0), lay = new Array(N).fill(0), drop = new Array(N).fill(0);
const _wInv = new THREE.Quaternion(), _face = new THREE.Quaternion(), _q = new THREE.Quaternion();
let started = false, t0 = 0, form = 0, spin = 0, state = 'intro';

function lp(a, b, t) { return a + (b - a) * t; }

function animate(now) {
  requestAnimationFrame(animate);
  if (!started) { t0 = now; started = true; }
  const tsec = (now - t0) / 1000;
  if (state === 'intro') { form = reduce ? 1 : Math.min(1, Math.max(0, (tsec - DELAY) / INTRO)); if (form >= 1) state = 'loop'; }
  const fe = form * form * (3 - 2 * form);

  // gentle idle spin until the user touches it
  if (state === 'loop' && selSec < 0 && !dragging) spin += 0.0016;
  const tgtP = selSec >= 0 ? 0 : pitch, tgtY = selSec >= 0 ? 0 : yaw + spin;
  dispP += (tgtP - dispP) * 0.06; dispY += (tgtY - dispY) * 0.06;
  world.rotation.set(dispP, dispY, 0);
  world.scale.setScalar(reduce ? 1 : lp(0.6, 1, fe));
  world.updateMatrixWorld();
  world.getWorldQuaternion(_wInv).invert();
  _face.copy(_wInv).multiply(camera.quaternion);

  for (let i = 0; i < N; i++) {
    const tp = (i === selSec) ? 1 : (i === hoverSec ? 1 : 0);
    pull[i] += (tp - pull[i]) * EZ;
    lay[i] += (((i === selSec) ? 1 : 0) - lay[i]) * EZ;
    drop[i] += (((selSec >= 0 && i !== selSec) ? 1 : 0) - drop[i]) * EZ;
  }

  for (const pc of pieces) {
    const i = pc.i;
    // rebuild the section's tubes only while it is actually morphing (idle = no rebuild)
    if (Math.abs(pull[i] - pc.lp) > 1e-4 || Math.abs(lay[i] - pc.ll) > 1e-4 || Math.abs(drop[i] - pc.ld) > 1e-4) {
      for (let l = 0; l < SL; l++) {
        const bA = pc.base[l], puA = pc.pulled[l], fA = pc.flat[l], pts = [];
        for (let j = 0; j < NP; j++) pts.push(morphPt(bA[j], puA[j], fA[j], pull[i], lay[i], drop[i]));
        pc.meshes[l].geometry.dispose(); pc.meshes[l].geometry = tubeGeo(pts);
      }
      pc.lp = pull[i]; pc.ll = lay[i]; pc.ld = drop[i];
    }
    pc.mat.opacity = (0.92 + 0.08 * Math.max(pull[i], lay[i])) * (1 - 0.85 * drop[i]) * fe;
  }

  for (const n of notes) {
    const i = n.sec, hot = pull[i] > 0.02 || lay[i] > 0.02;
    n.scale += ((hot ? 1.2 : 1) - n.scale) * 0.14;
    n.labS += ((lay[i] > 0.5 ? 1 : 0) - n.labS) * 0.12;
    const b = n.base; let x = b.x, y = b.y, z = b.z;
    if (pull[i] > 1e-3) { const p = n.pulled; x = lp(x, p.x, pull[i]); y = lp(y, p.y, pull[i]); z = lp(z, p.z, pull[i]); }
    if (lay[i] > 1e-3) { const f = n.flat; x = lp(x, f.x, lay[i]); y = lp(y, f.y, lay[i]); z = lp(z, f.z, lay[i]); }
    y -= DROPD * drop[i];
    n.g.position.set(x, y, z); n.g.scale.setScalar(n.scale * fe);
    _q.copy(n.baseQ); if (lay[i] > 1e-3) _q.slerp(_face, lay[i]); n.g.quaternion.copy(_q);
    n.lab.scale.set(1.1 * n.labS + 0.001, 0.22 * n.labS + 0.001, 1);
  }

  if (activeVid >= 0) vidTex.needsUpdate = true;
  for (const c of cards) {
    const i = c.i, vis = (pull[i] > 0.03 || lay[i] > 0.03) && fe > 0.9;
    c.card.visible = vis; if (!vis) continue;
    c.scale += (((i === selSec) ? 1.7 : 1) - c.scale) * 0.12;
    const b = c.base; let x = b.x, y = b.y, z = b.z;
    if (pull[i] > 1e-3) { x += secRadial[i].x * PULL * pull[i]; z += secRadial[i].z * PULL * pull[i]; }
    if (lay[i] > 1e-3) { const f = c.flat; x = lp(x, f.x, lay[i]); y = lp(y, f.y, lay[i]); z = lp(z, f.z, lay[i]); }
    c.card.position.set(x, y, z); c.card.scale.setScalar(c.scale); c.card.quaternion.copy(_face);
  }

  if (rotEl) rotEl.textContent = selSec >= 0 ? 'click again to close' : 'drag to rotate · hover a part · click to open';
  renderer.render(scene, camera);
}
// deep-link / preview a flattened section: ?open=sweep|pour|fold|sponge
const _op = new URLSearchParams(location.search).get('open');
if (_op) { const k = SHOW.findIndex(s => s.label.toLowerCase() === _op.toLowerCase()); if (k >= 0) setSel(k); }
requestAnimationFrame(animate);
