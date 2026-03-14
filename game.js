const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 500;
const BALL_RADIUS = 10;
const GOAL_WIDTH = 110;
const PEG_RADIUS = 5;
const MAX_BALL_GRAB = 35;
const FORCE_SCALE = 0.0006;
const MAX_FORCE = 0.12;
const GOAL_RESET_MS = 2000;
const LAYOUT_STORAGE_KEY = "binho-left-pegs";

const DEFAULT_LEFT_PEGS = [
  { id: "l1", x: 80, y: 160 },
  { id: "l2", x: 80, y: 250 },
  { id: "l3", x: 80, y: 340 },
  { id: "l4", x: 160, y: 100 },
  { id: "l5", x: 160, y: 400 },
  { id: "l6", x: 240, y: 160 },
  { id: "l7", x: 240, y: 250 },
  { id: "l8", x: 240, y: 340 },
  { id: "l9", x: 320, y: 100 },
  { id: "l10", x: 320, y: 400 },
];

const refs = {
  board: document.getElementById("board"),
  matterHost: document.getElementById("matter-host"),
  editorOverlay: document.getElementById("editor-overlay"),
  dragOverlay: document.getElementById("drag-overlay"),
  goalOverlay: document.getElementById("goal-overlay"),
  goalText: document.getElementById("goal-text"),
  practiceBtn: document.getElementById("mode-practice"),
  matchBtn: document.getElementById("mode-match"),
  editBtn: document.getElementById("mode-edit"),
  resetBtn: document.getElementById("reset-game"),
  modeIndicator: document.getElementById("mode-indicator"),
  playerOneCard: document.getElementById("player-one"),
  playerTwoCard: document.getElementById("player-two"),
  scoreP1: document.getElementById("score-p1"),
  scoreP2: document.getElementById("score-p2"),
  statusLight: document.getElementById("status-light"),
  statusText: document.getElementById("status-text"),
  statusNote: document.getElementById("status-note"),
};

const state = {
  gameMode: "practice",
  gameState: "aiming",
  turn: 1,
  score: { p1: 0, p2: 0 },
  lastGoal: null,
  leftPegs: loadLeftPegs(),
  draggingPegId: null,
  dragData: null,
};

const world = {
  engine: null,
  render: null,
  runner: null,
  ball: null,
  goalResetId: null,
  collisionHandler: null,
  afterUpdateHandler: null,
};

if (!window.Matter) {
  refs.statusText.textContent = "Matter.js failed to load.";
  refs.statusNote.textContent = "Reload with internet access to restore physics.";
  throw new Error("Matter.js is unavailable.");
}

const { Engine, Render, Runner, Bodies, Composite, Events, Body, Vector } = window.Matter;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneDefaultPegs() {
  return DEFAULT_LEFT_PEGS.map((peg) => ({ ...peg }));
}

function loadLeftPegs() {
  try {
    const saved = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) return cloneDefaultPegs();

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_LEFT_PEGS.length) return cloneDefaultPegs();

    const byId = new Map(
      parsed
        .filter(
          (peg) =>
            peg &&
            typeof peg.id === "string" &&
            typeof peg.x === "number" &&
            typeof peg.y === "number",
        )
        .map((peg) => [peg.id, peg]),
    );

    return DEFAULT_LEFT_PEGS.map((peg) => {
      const savedPeg = byId.get(peg.id);
      if (!savedPeg) return { ...peg };

      return {
        id: peg.id,
        x: clamp(savedPeg.x, 20, BOARD_WIDTH / 2 - 20),
        y: clamp(savedPeg.y, 10, BOARD_HEIGHT - 10),
      };
    });
  } catch {
    return cloneDefaultPegs();
  }
}

function saveLeftPegs() {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify(state.leftPegs.map((peg) => ({ id: peg.id, x: peg.x, y: peg.y }))),
  );
}

function getAllPegs() {
  return [
    ...state.leftPegs.map((peg) => ({ ...peg })),
    ...state.leftPegs.map((peg) => ({
      id: peg.id.replace("l", "r"),
      x: BOARD_WIDTH - peg.x,
      y: peg.y,
    })),
  ];
}

function destroyWorld() {
  if (world.goalResetId) {
    window.clearTimeout(world.goalResetId);
    world.goalResetId = null;
  }

  if (world.runner) Runner.stop(world.runner);

  if (world.render) {
    Render.stop(world.render);
    if (world.render.canvas) world.render.canvas.remove();
    world.render.textures = {};
  }

  if (world.engine) {
    if (world.collisionHandler) Events.off(world.engine, "collisionStart", world.collisionHandler);
    if (world.afterUpdateHandler) Events.off(world.engine, "afterUpdate", world.afterUpdateHandler);
    Engine.clear(world.engine);
  }

  refs.matterHost.innerHTML = "";

  world.engine = null;
  world.render = null;
  world.runner = null;
  world.ball = null;
  world.collisionHandler = null;
  world.afterUpdateHandler = null;
}

function createWorld() {
  destroyWorld();

  if (state.gameMode === "edit") return;

  const engine = Engine.create();
  engine.gravity.y = 0;
  world.engine = engine;

  const render = Render.create({
    element: refs.matterHost,
    engine,
    options: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      wireframes: false,
      background: "transparent",
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    },
  });
  world.render = render;

  const wallOptions = {
    isStatic: true,
    restitution: 0.95,
    friction: 0,
    render: { fillStyle: "transparent" },
  };
  const walls = [
    Bodies.rectangle(BOARD_WIDTH / 2, -10, BOARD_WIDTH, 40, wallOptions),
    Bodies.rectangle(BOARD_WIDTH / 2, BOARD_HEIGHT + 10, BOARD_WIDTH, 40, wallOptions),
    Bodies.rectangle(-10, BOARD_HEIGHT / 2 - GOAL_WIDTH / 2 - 150, 40, 300, wallOptions),
    Bodies.rectangle(-10, BOARD_HEIGHT / 2 + GOAL_WIDTH / 2 + 150, 40, 300, wallOptions),
    Bodies.rectangle(BOARD_WIDTH + 10, BOARD_HEIGHT / 2 - GOAL_WIDTH / 2 - 150, 40, 300, wallOptions),
    Bodies.rectangle(BOARD_WIDTH + 10, BOARD_HEIGHT / 2 + GOAL_WIDTH / 2 + 150, 40, 300, wallOptions),
  ];

  const wedgeOptions = {
    isStatic: true,
    restitution: 0.8,
    render: { visible: false },
  };
  const wedges = [
    Bodies.polygon(0, 0, 3, 50, { ...wedgeOptions, angle: Math.PI / 4 }),
    Bodies.polygon(BOARD_WIDTH, 0, 3, 50, { ...wedgeOptions, angle: Math.PI * 0.75 }),
    Bodies.polygon(0, BOARD_HEIGHT, 3, 50, { ...wedgeOptions, angle: -Math.PI / 4 }),
    Bodies.polygon(BOARD_WIDTH, BOARD_HEIGHT, 3, 50, { ...wedgeOptions, angle: -Math.PI * 0.75 }),
  ];

  const goalLeft = Bodies.rectangle(5, BOARD_HEIGHT / 2, 20, GOAL_WIDTH, {
    isStatic: true,
    isSensor: true,
    label: "goalLeft",
    render: { fillStyle: "#ef4444", opacity: 0.2 },
  });

  const goalRight = Bodies.rectangle(BOARD_WIDTH - 5, BOARD_HEIGHT / 2, 20, GOAL_WIDTH, {
    isStatic: true,
    isSensor: true,
    label: "goalRight",
    render: { fillStyle: "#3b82f6", opacity: 0.2 },
  });

  const ball = Bodies.circle(BOARD_WIDTH / 2, BOARD_HEIGHT / 2, BALL_RADIUS, {
    restitution: 0.8,
    frictionAir: 0.025,
    friction: 0.05,
    label: "ball",
    render: { fillStyle: "#ffffff", strokeStyle: "#111111", lineWidth: 2 },
  });
  world.ball = ball;

  const pegBodies = getAllPegs().map((peg) =>
    Bodies.circle(peg.x, peg.y, PEG_RADIUS, {
      isStatic: true,
      restitution: 0.5,
      render: { fillStyle: "#e2e8f0", strokeStyle: "#94a3b8", lineWidth: 2 },
    }),
  );

  Composite.add(engine.world, [...walls, ...wedges, goalLeft, goalRight, ball, ...pegBodies]);

  world.collisionHandler = (event) => {
    for (const pair of event.pairs) {
      const labels = [pair.bodyA.label, pair.bodyB.label];
      if (labels.includes("ball") && labels.includes("goalLeft")) {
        handleGoal("p2");
      } else if (labels.includes("ball") && labels.includes("goalRight")) {
        handleGoal("p1");
      }
    }
  };

  world.afterUpdateHandler = () => {
    if (!world.ball || world.ball.label === "scored") return;

    if (world.ball.speed > 0.1) {
      if (state.gameState === "aiming") {
        state.gameState = "moving";
        renderUI();
      }
      return;
    }

    if (state.gameState === "moving") {
      Body.setVelocity(world.ball, { x: 0, y: 0 });
      if (state.gameMode === "match") state.turn = state.turn === 1 ? 2 : 1;
      state.gameState = "aiming";
      renderUI();
    }
  };

  Events.on(engine, "collisionStart", world.collisionHandler);
  Events.on(engine, "afterUpdate", world.afterUpdateHandler);

  Render.run(render);
  world.runner = Runner.create();
  Runner.run(world.runner, engine);
}

function setGameMode(nextMode) {
  if (state.gameMode === nextMode) return;

  if (state.gameMode === "edit" && nextMode !== "edit") saveLeftPegs();

  state.gameMode = nextMode;
  state.draggingPegId = null;
  state.dragData = null;
  state.lastGoal = null;
  state.gameState = "aiming";

  createWorld();
  renderUI();
}

function toggleEditMode() {
  if (state.gameMode === "edit") {
    setGameMode("practice");
    return;
  }

  setGameMode("edit");
}

function handleGoal(player) {
  if (!world.ball || world.ball.label === "scored") return;

  world.ball.label = "scored";
  state.score[player] += 1;
  state.lastGoal = player;
  state.gameState = "goal";
  state.dragData = null;
  renderUI();

  world.goalResetId = window.setTimeout(() => {
    if (!world.ball) return;

    world.ball.label = "ball";
    Body.setPosition(world.ball, { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 });
    Body.setVelocity(world.ball, { x: 0, y: 0 });

    state.lastGoal = null;
    state.gameState = "aiming";
    if (state.gameMode === "match") state.turn = player === "p1" ? 2 : 1;

    world.goalResetId = null;
    renderUI();
  }, GOAL_RESET_MS);
}

function resetGame() {
  if (world.goalResetId) {
    window.clearTimeout(world.goalResetId);
    world.goalResetId = null;
  }

  state.score = { p1: 0, p2: 0 };
  state.turn = 1;
  state.lastGoal = null;
  state.draggingPegId = null;
  state.dragData = null;
  state.gameState = "aiming";

  if (world.ball) {
    world.ball.label = "ball";
    Body.setPosition(world.ball, { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 });
    Body.setVelocity(world.ball, { x: 0, y: 0 });
  }

  renderUI();
}

function toBoardPoint(event) {
  const rect = refs.board.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (BOARD_WIDTH / rect.width),
    y: (event.clientY - rect.top) * (BOARD_HEIGHT / rect.height),
  };
}

function updateLeftPeg(pegId, point) {
  state.leftPegs = state.leftPegs.map((peg) =>
    peg.id === pegId
      ? {
          ...peg,
          x: clamp(point.x, 20, BOARD_WIDTH / 2 - 20),
          y: clamp(point.y, 10, BOARD_HEIGHT - 10),
        }
      : peg,
  );
}

function handlePointerDown(event) {
  if (event.button !== 0) return;

  const point = toBoardPoint(event);

  if (state.gameMode === "edit") {
    const clickedPeg = state.leftPegs.find((peg) => Math.hypot(point.x - peg.x, point.y - peg.y) < 20);
    if (!clickedPeg) return;

    state.draggingPegId = clickedPeg.id;
    refs.board.setPointerCapture?.(event.pointerId);
    renderEditorOverlay();
    return;
  }

  if (state.gameState !== "aiming" || !world.ball) return;

  const distance = Math.hypot(point.x - world.ball.position.x, point.y - world.ball.position.y);
  if (distance >= MAX_BALL_GRAB) return;

  state.dragData = { startX: point.x, startY: point.y, currX: point.x, currY: point.y };
  refs.board.setPointerCapture?.(event.pointerId);
  renderDragOverlay();
}

function handlePointerMove(event) {
  const point = toBoardPoint(event);

  if (state.gameMode === "edit" && state.draggingPegId) {
    updateLeftPeg(state.draggingPegId, point);
    renderEditorOverlay();
    return;
  }

  if (!state.dragData) return;

  state.dragData.currX = point.x;
  state.dragData.currY = point.y;
  renderDragOverlay();
}

function handlePointerUp(event) {
  if (refs.board.hasPointerCapture?.(event.pointerId)) {
    refs.board.releasePointerCapture(event.pointerId);
  }

  if (state.gameMode === "edit") {
    if (state.draggingPegId) {
      state.draggingPegId = null;
      renderEditorOverlay();
    }
    return;
  }

  if (!state.dragData || !world.ball) {
    state.dragData = null;
    renderDragOverlay();
    return;
  }

  const forceDirection = Vector.sub(
    { x: state.dragData.startX, y: state.dragData.startY },
    { x: state.dragData.currX, y: state.dragData.currY },
  );
  const rawMagnitude = Vector.magnitude(forceDirection);

  if (rawMagnitude > 5) {
    const magnitude = Math.min(rawMagnitude * FORCE_SCALE, MAX_FORCE);
    Body.applyForce(world.ball, world.ball.position, {
      x: forceDirection.x * (magnitude / rawMagnitude),
      y: forceDirection.y * (magnitude / rawMagnitude),
    });
  }

  state.dragData = null;
  renderDragOverlay();
}

function renderModeButtons() {
  refs.practiceBtn.classList.toggle("is-active", state.gameMode === "practice");
  refs.matchBtn.classList.toggle("is-active", state.gameMode === "match");
  refs.editBtn.classList.toggle("is-active", state.gameMode === "edit");
  refs.editBtn.textContent = state.gameMode === "edit" ? "Save Layout" : "Edit Pegs";
}

function renderScoreboard() {
  refs.scoreP1.textContent = state.score.p1;
  refs.scoreP2.textContent = state.score.p2;

  refs.playerOneCard.classList.toggle("is-turn", state.gameMode === "match" && state.turn === 1);
  refs.playerTwoCard.classList.toggle("is-turn", state.gameMode === "match" && state.turn === 2);

  refs.modeIndicator.classList.toggle("is-editor", state.gameMode === "edit");
  refs.modeIndicator.innerHTML = state.gameMode === "edit" ? "EDITOR<br />ACTIVE" : "VS";
}

function renderGoalOverlay() {
  const isVisible = Boolean(state.lastGoal);
  refs.goalOverlay.classList.toggle("is-hidden", !isVisible);

  if (!isVisible) return;

  refs.goalText.textContent = state.lastGoal === "p1" ? "Player 1 Scores!" : "Player 2 Scores!";
  refs.goalText.className = `goal-text ${state.lastGoal === "p1" ? "is-p1" : "is-p2"}`;
}

function renderEditorOverlay() {
  if (state.gameMode !== "edit") {
    refs.editorOverlay.innerHTML = "";
    return;
  }

  const svg = getAllPegs()
    .map((peg) => {
      const isLeft = peg.id.startsWith("l");
      const markerLine = isLeft
        ? `<line x1="${peg.x}" y1="${peg.y}" x2="${BOARD_WIDTH - peg.x}" y2="${peg.y}" stroke="rgba(251, 191, 36, 0.24)" stroke-width="2" stroke-dasharray="6 6" />`
        : "";
      const halo =
        peg.id === state.draggingPegId
          ? `<circle cx="${peg.x}" cy="${peg.y}" r="20" fill="rgba(251, 191, 36, 0.2)" />`
          : "";
      const fill = isLeft ? "#fbbf24" : "#94a3b8";

      return `
        <g>
          ${markerLine}
          ${halo}
          <circle cx="${peg.x}" cy="${peg.y}" r="${PEG_RADIUS + 2}" fill="${fill}" />
        </g>
      `;
    })
    .join("");

  refs.editorOverlay.innerHTML = `<svg viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" width="100%" height="100%">${svg}</svg>`;
}

function renderDragOverlay() {
  if (!state.dragData || state.gameMode === "edit" || state.gameState !== "aiming") {
    refs.dragOverlay.innerHTML = "";
    return;
  }

  const color = state.turn === 1 ? "#34d399" : "#60a5fa";
  const aimX = state.dragData.startX + (state.dragData.startX - state.dragData.currX);
  const aimY = state.dragData.startY + (state.dragData.startY - state.dragData.currY);

  refs.dragOverlay.innerHTML = `
    <svg viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" width="100%" height="100%">
      <line
        x1="${state.dragData.startX}"
        y1="${state.dragData.startY}"
        x2="${aimX}"
        y2="${aimY}"
        stroke="rgba(255, 255, 255, 0.6)"
        stroke-width="3"
        stroke-dasharray="6 6"
      />
      <line
        x1="${state.dragData.startX}"
        y1="${state.dragData.startY}"
        x2="${state.dragData.currX}"
        y2="${state.dragData.currY}"
        stroke="${color}"
        stroke-width="4"
      />
      <circle cx="${state.dragData.currX}" cy="${state.dragData.currY}" r="6" fill="${color}" />
    </svg>
  `;
}

function renderStatusBar() {
  refs.board.classList.toggle("is-editing", state.gameMode === "edit");

  refs.statusLight.className = "status-light";

  if (state.gameMode === "edit") {
    refs.statusLight.classList.add("is-editing");
    refs.statusText.textContent = "Editor: Drag gold pegs to move them. Gray pegs mirror automatically.";
    refs.statusNote.textContent = "Symmetry is forced to ensure fair play.";
    return;
  }

  if (state.gameState === "moving") {
    refs.statusLight.classList.add("is-moving");
    refs.statusText.textContent = "Ball in Motion...";
    refs.statusNote.textContent = "Wait for the ball to stop before the next flick.";
    return;
  }

  if (state.gameState === "goal") {
    refs.statusLight.classList.add("is-moving");
    refs.statusText.textContent = state.lastGoal === "p1" ? "Player 1 scored." : "Player 2 scored.";
    refs.statusNote.textContent = "Ball resets to center after the goal sequence.";
    return;
  }

  refs.statusLight.classList.add("is-ready");
  refs.statusText.textContent = state.gameMode === "match" ? `Player ${state.turn}'s Turn` : "Ready to Flick";
  refs.statusNote.textContent = "Drag ball back to aim.";
}

function renderUI() {
  renderModeButtons();
  renderScoreboard();
  renderGoalOverlay();
  renderEditorOverlay();
  renderDragOverlay();
  renderStatusBar();
}

refs.practiceBtn.addEventListener("click", () => setGameMode("practice"));
refs.matchBtn.addEventListener("click", () => setGameMode("match"));
refs.editBtn.addEventListener("click", toggleEditMode);
refs.resetBtn.addEventListener("click", resetGame);

refs.board.addEventListener("pointerdown", handlePointerDown);
refs.board.addEventListener("pointermove", handlePointerMove);
refs.board.addEventListener("pointerup", handlePointerUp);
refs.board.addEventListener("pointercancel", handlePointerUp);

createWorld();
renderUI();
