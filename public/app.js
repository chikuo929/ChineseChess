const socket = io();

const board = document.querySelector("#board");
const statusEl = document.querySelector("#status");
const roomLabel = document.querySelector("#roomLabel");
const resetButton = document.querySelector("#resetButton");
const copyLinkButton = document.querySelector("#copyLinkButton");
const viewButton = document.querySelector("#viewButton");
const undoButton = document.querySelector("#undoButton");
const redCaptured = document.querySelector("#redCaptured");
const blackCaptured = document.querySelector("#blackCaptured");

const roomId = getRoomId();
const pieces = new Map();
let activePiece = null;
let activePointerId = null;
let viewSide = localStorage.getItem("xiangqi-view-side") || "red";
let gridLayer = null;

roomLabel.textContent = `\u623f\u95f4\uff1a${roomId}`;

drawBoard();
syncViewButton();
socket.emit("join-room", roomId);

socket.on("connect", () => {
  statusEl.textContent = "\u5df2\u8fde\u63a5";
  socket.emit("join-room", roomId);
});

socket.on("disconnect", () => {
  statusEl.textContent = "\u5df2\u65ad\u5f00";
});

socket.on("player-count", (count) => {
  statusEl.textContent = `\u5728\u7ebf\uff1a${count} \u4eba`;
});

socket.on("room-state", ({ pieces: serverPieces, canUndo }) => {
  renderPieces(serverPieces);
  undoButton.disabled = !canUndo;
});

resetButton.addEventListener("click", () => {
  socket.emit("reset-board", roomId);
});

undoButton.addEventListener("click", () => {
  socket.emit("undo", roomId);
});

viewButton.addEventListener("click", () => {
  viewSide = viewSide === "red" ? "black" : "red";
  localStorage.setItem("xiangqi-view-side", viewSide);
  syncViewButton();
  placeAllPieces();
});

copyLinkButton.addEventListener("click", async () => {
  const link = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;

  try {
    await navigator.clipboard.writeText(link);
    copyLinkButton.textContent = "\u5df2\u590d\u5236";
    setTimeout(() => {
      copyLinkButton.textContent = "\u590d\u5236\u623f\u95f4\u94fe\u63a5";
    }, 1200);
  } catch {
    window.prompt("\u590d\u5236\u8fd9\u4e2a\u623f\u95f4\u94fe\u63a5", link);
  }
});

window.addEventListener("resize", placeAllPieces);

function getRoomId() {
  const pathMatch = window.location.pathname.match(/^\/room\/([^/]+)$/);
  const queryRoom = new URLSearchParams(window.location.search).get("room");
  return decodeURIComponent(pathMatch?.[1] || queryRoom || "default");
}

function drawBoard() {
  gridLayer = document.createElement("div");
  gridLayer.className = "board-grid";

  const svg = createSvgElement("svg");
  svg.classList.add("board-svg");
  svg.setAttribute("viewBox", "0 0 8 9");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  for (let x = 0; x < 9; x += 1) {
    svg.appendChild(createLine(x, 0, x, 9, "grid-line"));
  }

  for (let y = 0; y < 10; y += 1) {
    svg.appendChild(createLine(0, y, 8, y, "grid-line"));
  }

  svg.appendChild(createLine(3, 0, 5, 2, "palace-line"));
  svg.appendChild(createLine(5, 0, 3, 2, "palace-line"));
  svg.appendChild(createLine(3, 7, 5, 9, "palace-line"));
  svg.appendChild(createLine(5, 7, 3, 9, "palace-line"));

  gridLayer.appendChild(svg);
  board.prepend(gridLayer);
}

function createSvgElement(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function createLine(x1, y1, x2, y2, className) {
  const line = createSvgElement("line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("class", className);
  return line;
}

function renderPieces(serverPieces) {
  const seen = new Set();
  redCaptured.replaceChildren();
  blackCaptured.replaceChildren();

  serverPieces.forEach((piece) => {
    seen.add(piece.id);
    updatePiece(piece);
  });

  for (const [id, item] of pieces) {
    if (!seen.has(id)) {
      item.el.remove();
      pieces.delete(id);
    }
  }
}

function updatePiece(piece) {
  let item = pieces.get(piece.id);

  if (!item) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `piece ${piece.side}`;
    el.dataset.id = piece.id;
    el.addEventListener("pointerdown", startDrag);
    board.appendChild(el);
    item = { el, ...piece };
    pieces.set(piece.id, item);
  }

  Object.assign(item, piece);
  item.el.className = `piece ${piece.side}`;
  item.el.textContent = piece.name;

  if (piece.captured) {
    item.el.remove();
    renderCapturedPiece(piece);
    return;
  }

  if (!board.contains(item.el)) {
    board.appendChild(item.el);
  }

  if (activePiece?.dataset.id !== piece.id) {
    placePiece(item.el, piece.x, piece.y);
  }
}

function renderCapturedPiece(piece) {
  const el = document.createElement("span");
  el.className = `captured-piece ${piece.side}`;
  el.textContent = piece.name;

  if (piece.capturedBy === "red") {
    redCaptured.appendChild(el);
  } else if (piece.capturedBy === "black") {
    blackCaptured.appendChild(el);
  }
}

function startDrag(event) {
  activePiece = event.currentTarget;
  activePointerId = event.pointerId;
  activePiece.classList.add("dragging");
  activePiece.setPointerCapture(activePointerId);
  moveActivePiece(event);

  activePiece.addEventListener("pointermove", moveActivePiece);
  activePiece.addEventListener("pointerup", finishDrag, { once: true });
  activePiece.addEventListener("pointercancel", finishDrag, { once: true });
}

function moveActivePiece(event) {
  if (!activePiece || event.pointerId !== activePointerId) return;

  const rect = board.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  activePiece.style.left = `${Math.max(0, Math.min(rect.width, x))}px`;
  activePiece.style.top = `${Math.max(0, Math.min(rect.height, y))}px`;
}

function finishDrag(event) {
  if (!activePiece || event.pointerId !== activePointerId) return;

  activePiece.removeEventListener("pointermove", moveActivePiece);
  activePiece.classList.remove("dragging");

  const grid = pointerToGrid(event);
  const pieceId = activePiece.dataset.id;
  const item = pieces.get(pieceId);

  item.x = grid.x;
  item.y = grid.y;
  placePiece(activePiece, grid.x, grid.y);
  socket.emit("move-piece", { roomId, pieceId, x: grid.x, y: grid.y });

  activePiece = null;
  activePointerId = null;
}

function pointerToGrid(event) {
  const metrics = getGridMetrics();
  const visualX = Math.round(((event.clientX - metrics.left) / metrics.width) * 8);
  const visualY = Math.round(((event.clientY - metrics.top) / metrics.height) * 9);

  return visualToBoard(clamp(visualX, 0, 8), clamp(visualY, 0, 9));
}

function placeAllPieces() {
  for (const item of pieces.values()) {
    if (!item.captured) {
      placePiece(item.el, item.x, item.y);
    }
  }
}

function placePiece(el, x, y) {
  const visual = boardToVisual(x, y);
  const metrics = getGridMetrics();
  el.style.left = `${metrics.padX + (visual.x / 8) * metrics.width}px`;
  el.style.top = `${metrics.padY + (visual.y / 9) * metrics.height}px`;
}

function getGridMetrics() {
  const boardRect = board.getBoundingClientRect();
  const gridRect = gridLayer.getBoundingClientRect();

  return {
    left: gridRect.left,
    top: gridRect.top,
    padX: gridRect.left - boardRect.left - board.clientLeft,
    padY: gridRect.top - boardRect.top - board.clientTop,
    width: gridRect.width,
    height: gridRect.height
  };
}

function boardToVisual(x, y) {
  if (viewSide === "black") {
    return { x: 8 - x, y: 9 - y };
  }

  return { x, y };
}

function visualToBoard(x, y) {
  if (viewSide === "black") {
    return { x: 8 - x, y: 9 - y };
  }

  return { x, y };
}

function syncViewButton() {
  viewButton.textContent = viewSide === "red" ? "\u5207\u5230\u9ed1\u65b9\u89c6\u89d2" : "\u5207\u5230\u7ea2\u65b9\u89c6\u89d2";
  board.dataset.view = viewSide;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


