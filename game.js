import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";

const gameEl = document.getElementById("game");

const scoreBlueEl = document.getElementById("score-blue");
const scoreRedEl = document.getElementById("score-red");
const turnLabelEl = document.getElementById("turn-label");
const statusLabelEl = document.getElementById("status-label");

const resetTurnBtn = document.getElementById("reset-turn");
const resetMatchBtn = document.getElementById("reset-match");

const TABLE = {
  width: 92,
  height: 56,
  friction: 0.986,
  wallBounce: 0.86,
  goalWidth: 20,
  ballRadius: 1.15,
  pegRadius: 0.72,
  ballGrabRadius: 2.6,
  maxDrag: 14,
  flickScale: 0.15,
};

// Tune only the left-side peg coordinates; the right side mirrors automatically.
const LEFT_PEG_LAYOUT = [
  [-34.5, -4],
  [-34.5, 4],
  [-30.5, 0],
  [-27.5, -5],
  [-27.5, 5],
  [-23, -8],
  [-23, 0],
  [-23, 8],
  [-17.5, -6],
  [-17.5, 6],
  [-14, 0],
];

const state = {
  turn: "blue",
  score: { blue: 0, red: 0 },
  dragging: null,
  gameOver: false,
  ball: null,
  pegs: [],
  waitingForStop: false,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#d8dde5");

const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 500);
camera.position.set(0, 88, 2);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
gameEl.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#ffffff", "#5a5f66", 0.55));
const sun = new THREE.DirectionalLight("#ffffff", 1.05);
sun.position.set(-44, 65, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragHit = new THREE.Vector3();

const fieldGroup = new THREE.Group();
scene.add(fieldGroup);

function buildBoard() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width + 18, 2.2, TABLE.height + 18),
    new THREE.MeshStandardMaterial({ color: "#f4f4f4", roughness: 0.85 }),
  );
  base.position.y = -1.35;
  base.receiveShadow = true;
  fieldGroup.add(base);

  const grass = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width, 0.9, TABLE.height),
    new THREE.MeshStandardMaterial({ color: "#1f5f2e", roughness: 0.95 }),
  );
  grass.position.y = -0.35;
  grass.receiveShadow = true;
  fieldGroup.add(grass);

  const stripeMatA = new THREE.MeshStandardMaterial({ color: "#205e31", roughness: 0.95 });
  const stripeMatB = new THREE.MeshStandardMaterial({ color: "#226535", roughness: 0.95 });
  const stripeW = TABLE.width / 8;
  for (let i = 0; i < 8; i += 1) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(stripeW, TABLE.height),
      i % 2 === 0 ? stripeMatA : stripeMatB,
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-TABLE.width / 2 + stripeW / 2 + i * stripeW, 0.02, 0);
    fieldGroup.add(stripe);
  }

  const lineMat = new THREE.LineBasicMaterial({ color: "#f5f5f5" });
  const mkLine = (pts) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], 0.08, p[1])));
    fieldGroup.add(new THREE.Line(g, lineMat));
  };

  const w = TABLE.width / 2;
  const h = TABLE.height / 2;
  mkLine([
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
    [-w, -h],
  ]);
  mkLine([
    [0, -h],
    [0, h],
  ]);

  const circlePts = [];
  for (let i = 0; i <= 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    circlePts.push([Math.cos(a) * 8.8, Math.sin(a) * 8.8]);
  }
  mkLine(circlePts);

  const centerSpot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.05, 18),
    new THREE.MeshStandardMaterial({ color: "#efefef" }),
  );
  centerSpot.position.set(0, 0.09, 0);
  fieldGroup.add(centerSpot);

  const drawBoxSide = (left) => {
    const dir = left ? -1 : 1;
    const x0 = dir * (w - 11);
    const x1 = dir * w;

    mkLine([
      [x1, -11],
      [x0, -11],
      [x0, 11],
      [x1, 11],
    ]);

    const sx0 = dir * (w - 5.5);
    mkLine([
      [x1, -6],
      [sx0, -6],
      [sx0, 6],
      [x1, 6],
    ]);

    const spot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.05, 14),
      new THREE.MeshStandardMaterial({ color: "#efefef" }),
    );
    spot.position.set(dir * (w - 8), 0.09, 0);
    fieldGroup.add(spot);

    const arcPts = [];
    const radius = 4.8;
    const start = left ? -0.35 * Math.PI : 0.65 * Math.PI;
    const end = left ? 0.35 * Math.PI : 1.35 * Math.PI;
    for (let i = 0; i <= 36; i += 1) {
      const a = start + ((end - start) * i) / 36;
      arcPts.push([dir * (w - 8) + Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    mkLine(arcPts);
  };
  drawBoxSide(true);
  drawBoxSide(false);

  // Elastic bands + corner posts
  const railMat = new THREE.MeshStandardMaterial({ color: "#d4d8df", roughness: 0.45, metalness: 0.08 });
  const postMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 });
  const railRadius = 0.42;

  const addRail = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(railRadius, railRadius, len, 20), railMat);
    rail.position.set((x1 + x2) / 2, 1.2, (z1 + z2) / 2);
    rail.rotation.z = Math.PI / 2;
    rail.rotation.y = Math.atan2(z2 - z1, x2 - x1);
    rail.castShadow = true;
    fieldGroup.add(rail);
  };

  const rw = w + 2.1;
  const rh = h + 2.1;
  addRail(-rw, -rh, rw, -rh);
  addRail(-rw, rh, rw, rh);
  addRail(-rw, -rh, -rw, rh);
  addRail(rw, -rh, rw, rh);

  for (const [x, z] of [
    [-rw, -rh],
    [rw, -rh],
    [-rw, rh],
    [rw, rh],
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 2.2, 24), postMat);
    post.position.set(x, 1.05, z);
    post.castShadow = true;
    fieldGroup.add(post);
  }

  // Goals with simple net frame
  const goalMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 });
  const addGoal = (left) => {
    const dir = left ? -1 : 1;
    const goalDepth = 3.6;
    const gx = dir * (w + goalDepth * 0.5);

    const frame = new THREE.Group();

    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.8, 12), goalMat);
    post1.position.set(gx, 1.9, -TABLE.goalWidth / 2);
    const post2 = post1.clone();
    post2.position.z *= -1;

    const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, TABLE.goalWidth, 12), goalMat);
    cross.rotation.x = Math.PI / 2;
    cross.position.set(gx, 3.7, 0);

    const backTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, TABLE.goalWidth, 12), goalMat);
    backTop.rotation.x = Math.PI / 2;
    backTop.position.set(gx + dir * goalDepth, 3.2, 0);

    const backBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, TABLE.goalWidth, 12), goalMat);
    backBottom.rotation.x = Math.PI / 2;
    backBottom.position.set(gx + dir * goalDepth, 0.6, 0);

    const backPost1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 10), goalMat);
    backPost1.position.set(gx + dir * goalDepth, 1.9, -TABLE.goalWidth / 2);
    const backPost2 = backPost1.clone();
    backPost2.position.z *= -1;

    frame.add(post1, post2, cross, backTop, backBottom, backPost1, backPost2);

    // net lines
    const netMat = new THREE.LineBasicMaterial({ color: "#e9eef7" });
    for (let i = -5; i <= 5; i += 1) {
      const z = (i / 5) * (TABLE.goalWidth / 2);
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(gx, 0.6, z),
        new THREE.Vector3(gx + dir * goalDepth, 0.6, z),
        new THREE.Vector3(gx + dir * goalDepth, 3.2, z),
        new THREE.Vector3(gx, 3.7, z),
      ]);
      frame.add(new THREE.Line(geom, netMat));
    }

    fieldGroup.add(frame);
  };

  addGoal(true);
  addGoal(false);
}

function currentTurnName() {
  return state.turn[0].toUpperCase() + state.turn.slice(1);
}

function createBall(x = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(TABLE.ballRadius, 30, 20),
    new THREE.MeshStandardMaterial({ color: "#fbf2c9", roughness: 0.22 }),
  );

  mesh.position.set(x, TABLE.ballRadius, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, x, z, vx: 0, vz: 0, radius: TABLE.ballRadius };
}

function createPeg(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE.pegRadius, TABLE.pegRadius, 1.45, 20),
    new THREE.MeshStandardMaterial({ color: "#f6f6f6", roughness: 0.3 }),
  );
  mesh.position.set(x, 0.75, z);
  mesh.castShadow = true;
  scene.add(mesh);
  state.pegs.push({ x, z, radius: TABLE.pegRadius, mesh });
}

function seedPegs() {
  for (const peg of state.pegs) scene.remove(peg.mesh);
  state.pegs = [];

  for (const [x, z] of LEFT_PEG_LAYOUT) {
    createPeg(x, z);
    createPeg(-x, z);
  }
}

function seedBall() {
  if (state.ball) scene.remove(state.ball.mesh);
  state.ball = createBall();
}

function updateStatus(text) {
  statusLabelEl.textContent = text;
}

function updateHud() {
  scoreBlueEl.textContent = state.score.blue;
  scoreRedEl.textContent = state.score.red;
  turnLabelEl.textContent = currentTurnName();
}

function resetTurn() {
  seedBall();
  seedPegs();
  if (state.dragging?.arrow) scene.remove(state.dragging.arrow);
  state.dragging = null;
  state.waitingForStop = false;
  updateStatus(`${currentTurnName()} to flick the ball.`);
}

function resetMatch() {
  state.turn = "blue";
  state.score.blue = 0;
  state.score.red = 0;
  state.gameOver = false;
  updateHud();
  resetTurn();
}

function switchTurn() {
  state.turn = state.turn === "blue" ? "red" : "blue";
  updateHud();
  updateStatus(`${currentTurnName()} to flick the ball.`);
}

function allStopped() {
  return !state.ball || Math.hypot(state.ball.vx, state.ball.vz) < 0.03;
}

function goalCheck() {
  const ball = state.ball;
  if (!ball) return false;
  const inGoalZ = Math.abs(ball.z) <= TABLE.goalWidth / 2;

  if (ball.x < -TABLE.width / 2 + ball.radius && inGoalZ) {
    state.score.red += 1;
    updateStatus("Red scores!");
    afterGoal();
    return true;
  } else if (ball.x > TABLE.width / 2 - ball.radius && inGoalZ) {
    state.score.blue += 1;
    updateStatus("Blue scores!");
    afterGoal();
    return true;
  }

  return false;
}

function afterGoal() {
  updateHud();
  state.waitingForStop = false;
  if (state.score.blue >= 5 || state.score.red >= 5) {
    state.gameOver = true;
    const winner = state.score.blue > state.score.red ? "Blue" : "Red";
    updateStatus(`${winner} wins 5 goals! Press New Match to play again.`);
    return;
  }
  switchTurn();
  setTimeout(resetTurn, 550);
}

function resolveWall(ball) {
  const inGoalZ = Math.abs(ball.z) <= TABLE.goalWidth / 2;
  if (!inGoalZ) {
    if (ball.x - ball.radius < -TABLE.width / 2) {
      ball.x = -TABLE.width / 2 + ball.radius;
      ball.vx *= -TABLE.wallBounce;
    }
    if (ball.x + ball.radius > TABLE.width / 2) {
      ball.x = TABLE.width / 2 - ball.radius;
      ball.vx *= -TABLE.wallBounce;
    }
  }
  if (ball.z - ball.radius < -TABLE.height / 2) {
    ball.z = -TABLE.height / 2 + ball.radius;
    ball.vz *= -TABLE.wallBounce;
  }
  if (ball.z + ball.radius > TABLE.height / 2) {
    ball.z = TABLE.height / 2 - ball.radius;
    ball.vz *= -TABLE.wallBounce;
  }
}

function resolvePegCollision(actor, peg) {
  const dx = actor.x - peg.x;
  const dz = actor.z - peg.z;
  const dist = Math.hypot(dx, dz);
  const minDist = actor.radius + peg.radius;
  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  actor.x += nx * overlap;
  actor.z += nz * overlap;

  const dot = actor.vx * nx + actor.vz * nz;
  if (dot < 0) {
    actor.vx -= (1 + 0.84) * dot * nx;
    actor.vz -= (1 + 0.84) * dot * nz;
  }
}

function stepPhysics() {
  const ball = state.ball;
  if (!ball) return;

  ball.x += ball.vx;
  ball.z += ball.vz;
  ball.vx *= TABLE.friction;
  ball.vz *= TABLE.friction;

  if (Math.abs(ball.vx) < 0.008) ball.vx = 0;
  if (Math.abs(ball.vz) < 0.008) ball.vz = 0;

  resolveWall(ball);
  for (const peg of state.pegs) resolvePegCollision(ball, peg);

  if (goalCheck()) return;

  if (state.waitingForStop && allStopped() && !state.gameOver) {
    state.waitingForStop = false;
    switchTurn();
  }
}

function syncMeshes() {
  if (!state.ball) return;

  state.ball.mesh.position.x = state.ball.x;
  state.ball.mesh.position.z = state.ball.z;
  state.ball.mesh.rotation.x += state.ball.vz * 0.03;
  state.ball.mesh.rotation.z -= state.ball.vx * 0.03;
}

function resize() {
  const width = gameEl.clientWidth;
  const height = gameEl.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function pointerToPlane(evt) {
  const rect = gameEl.getBoundingClientRect();
  pointer.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(dragPlane, dragHit) ? dragHit.clone() : null;
}

function ballAtPoint(point) {
  if (!state.ball) return null;
  return Math.hypot(point.x - state.ball.x, point.z - state.ball.z) <= TABLE.ballGrabRadius ? state.ball : null;
}

function tick() {
  stepPhysics();
  syncMeshes();

  if (state.dragging) {
    const { ball, point } = state.dragging;
    const dx = ball.x - point.x;
    const dz = ball.z - point.z;
    const length = Math.min(Math.hypot(dx, dz), TABLE.maxDrag);

    if (!state.dragging.arrow) {
      const arrowColor = state.turn === "blue" ? 0x4ea7ff : 0xff6666;
      state.dragging.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(ball.x, 1.6, ball.z), 1, arrowColor, 1.2, 0.8);
      scene.add(state.dragging.arrow);
    }

    const dir = new THREE.Vector3(dx || 0.001, 0, dz || 0.001).normalize();
    state.dragging.arrow.position.set(ball.x, 1.6, ball.z);
    state.dragging.arrow.setDirection(dir);
    state.dragging.arrow.setLength(length, 1.2, 0.8);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);

renderer.domElement.addEventListener("pointerdown", (evt) => {
  if (state.gameOver || state.waitingForStop || !allStopped()) return;
  const point = pointerToPlane(evt);
  if (!point) return;

  const ball = ballAtPoint(point);
  if (!ball) return;

  state.dragging = { ball, point };
  updateStatus(`${currentTurnName()} is aiming the ball.`);
});

renderer.domElement.addEventListener("pointermove", (evt) => {
  if (!state.dragging) return;
  const point = pointerToPlane(evt);
  if (!point) return;
  state.dragging.point = point;
});

renderer.domElement.addEventListener("pointerup", () => {
  if (!state.dragging) return;

  const { ball, point, arrow } = state.dragging;
  const dx = ball.x - point.x;
  const dz = ball.z - point.z;
  const strength = Math.min(Math.hypot(dx, dz), TABLE.maxDrag);

  if (arrow) scene.remove(arrow);
  state.dragging = null;

  if (strength < 0.35) {
    updateStatus(`${currentTurnName()} to flick the ball.`);
    return;
  }

  ball.vx += dx * TABLE.flickScale;
  ball.vz += dz * TABLE.flickScale;
  state.waitingForStop = true;
  updateStatus(`${currentTurnName()} flicked the ball at ${Math.round((strength / TABLE.maxDrag) * 100)}% power.`);
});

resetTurnBtn.addEventListener("click", resetTurn);
resetMatchBtn.addEventListener("click", resetMatch);

buildBoard();
resize();
resetTurn();
updateHud();
tick();
