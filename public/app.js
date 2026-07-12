const socket = io();

const board = document.querySelector("#board");
const statusEl = document.querySelector("#status");
const roomLabel = document.querySelector("#roomLabel");
const resetButton = document.querySelector("#resetButton");
const copyLinkButton = document.querySelector("#copyLinkButton");
const viewButton = document.querySelector("#viewButton");
const undoButton = document.querySelector("#undoButton");
const setupButton = document.querySelector("#setupButton");
const setupActions = document.querySelector("#setupActions");
const clearSetupButton = document.querySelector("#clearSetupButton");
const standardSetupButton = document.querySelector("#standardSetupButton");
const finishSetupButton = document.querySelector("#finishSetupButton");
const cancelSetupButton = document.querySelector("#cancelSetupButton");
const redCaptured = document.querySelector("#redCaptured");
const blackCaptured = document.querySelector("#blackCaptured");
const annotationModeButton = document.querySelector("#annotationModeButton");
const annotationToolbar = document.querySelector("#annotationToolbar");
const undoAnnotationButton = document.querySelector("#undoAnnotationButton");
const clearAnnotationsButton = document.querySelector("#clearAnnotationsButton");
const annotationToolButtons = [...document.querySelectorAll(".annotation-tool")];
const annotationColorButtons = [...document.querySelectorAll(".color-tool")];

const roomId = getRoomId();
const pieces = new Map();
let activePiece = null;
let activePointerId = null;
let activeDragWasCaptured = false;
let activePointerPosition = null;
let viewSide = localStorage.getItem("xiangqi-view-side") || "red";
let gridLayer = null;
let lastRoomSnapshot = null;
let suppressNextMoveSound = false;
let audioContext = null;
let fallbackMoveAudio = null;
let setupMode = false;
let annotationLayer = null;
let annotationMarksGroup = null;
let annotationMode = false;
let annotationTool = "arrow";
let annotationColor = "red";
let annotations = [];
let annotationDraft = null;
let annotationPointerId = null;
let lastPreviewSentAt = 0;
const remoteAnnotationDrafts = new Map();

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

socket.on("room-state", ({ pieces: serverPieces, canUndo, setupMode: serverSetupMode, annotations: serverAnnotations = [] }) => {
  const nextSnapshot = snapshotPieces(serverPieces);

  if (lastRoomSnapshot && nextSnapshot !== lastRoomSnapshot) {
    if (suppressNextMoveSound) {
      suppressNextMoveSound = false;
    } else {
      playMoveSound();
    }
  }

  lastRoomSnapshot = nextSnapshot;
  renderPieces(serverPieces);
  undoButton.disabled = !canUndo;
  setupMode = Boolean(serverSetupMode);
  annotations = serverAnnotations;
  remoteAnnotationDrafts.clear();
  renderAnnotations();
  syncSetupControls();
});

socket.on("annotations-state", (serverAnnotations) => {
  annotations = Array.isArray(serverAnnotations) ? serverAnnotations : [];
  renderAnnotations();
});

socket.on("annotation-preview", ({ clientId, annotation }) => {
  if (annotation) {
    remoteAnnotationDrafts.set(clientId, annotation);
  } else {
    remoteAnnotationDrafts.delete(clientId);
  }
  renderAnnotations();
});

resetButton.addEventListener("click", () => {
  socket.emit("reset-board", roomId);
});

undoButton.addEventListener("click", () => {
  socket.emit("undo", roomId);
});

setupButton.addEventListener("click", () => {
  socket.emit("start-setup", roomId);
});

clearSetupButton.addEventListener("click", () => {
  if (window.confirm("确定要清空棋盘吗？所有棋子会移回各自棋子区。")) {
    socket.emit("clear-setup-board", roomId);
  }
});

standardSetupButton.addEventListener("click", () => {
  if (window.confirm("确定要恢复标准开局吗？当前布置将被替换。")) {
    socket.emit("restore-standard-setup", roomId);
  }
});

finishSetupButton.addEventListener("click", () => {
  socket.emit("finish-setup", roomId);
});

cancelSetupButton.addEventListener("click", () => {
  if (window.confirm("确定要取消布置吗？将恢复进入布置模式前的完整局面。")) {
    socket.emit("cancel-setup", roomId);
  }
});

viewButton.addEventListener("click", () => {
  viewSide = viewSide === "red" ? "black" : "red";
  localStorage.setItem("xiangqi-view-side", viewSide);
  syncViewButton();
  placeAllPieces();
  renderAnnotations();
});

annotationModeButton.addEventListener("click", () => {
  setAnnotationMode(!annotationMode);
});

annotationToolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    annotationTool = button.dataset.tool;
    syncAnnotationControls();
  });
});

annotationColorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    annotationColor = button.dataset.color;
    syncAnnotationControls();
  });
});

undoAnnotationButton.addEventListener("click", () => {
  socket.emit("annotation-undo", roomId);
});

clearAnnotationsButton.addEventListener("click", () => {
  socket.emit("annotations-clear", roomId);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && annotationDraft) cancelAnnotationDraft();
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
window.addEventListener("pointerdown", unlockAudio, { once: true });

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
    if (x === 0 || x === 8) {
      svg.appendChild(createLine(x, 0, x, 9, "grid-line"));
    } else {
      svg.appendChild(createLine(x, 0, x, 4, "grid-line"));
      svg.appendChild(createLine(x, 5, x, 9, "grid-line"));
    }
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

  annotationLayer = createSvgElement("svg");
  annotationLayer.classList.add("annotation-layer");
  annotationLayer.setAttribute("viewBox", "0 0 8 9");
  annotationLayer.setAttribute("preserveAspectRatio", "none");
  annotationLayer.setAttribute("aria-label", "棋盘讲解标注层");

  const defs = createSvgElement("defs");
  defs.appendChild(createArrowMarker("annotation-arrow-red", "#d52b28"));
  defs.appendChild(createArrowMarker("annotation-arrow-blue", "#2563c9"));
  annotationLayer.appendChild(defs);

  annotationMarksGroup = createSvgElement("g");
  annotationLayer.appendChild(annotationMarksGroup);
  annotationLayer.addEventListener("pointerdown", startAnnotation);
  board.appendChild(annotationLayer);
}

function createArrowMarker(id, color) {
  const marker = createSvgElement("marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 4 2");
  marker.setAttribute("refX", "3.5");
  marker.setAttribute("refY", "1");
  marker.setAttribute("markerWidth", "3.5");
  marker.setAttribute("markerHeight", "3.5");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = createSvgElement("path");
  path.setAttribute("d", "M 0 0 L 4 1 L 0 2 Z");
  path.setAttribute("fill", color);
  marker.appendChild(path);
  return marker;
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

function snapshotPieces(serverPieces) {
  return serverPieces
    .map((piece) => `${piece.id}:${piece.x}:${piece.y}:${piece.captured}:${piece.capturedBy || ""}`)
    .sort()
    .join("|");
}

function unlockAudio() {
  if (audioContext || fallbackMoveAudio) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  if (AudioContext) {
    audioContext = new AudioContext();
    return;
  }

  fallbackMoveAudio = new Audio(createMoveSoundDataUrl());
  fallbackMoveAudio.preload = "auto";
}

function createMoveSoundDataUrl() {
  const sampleRate = 8000;
  const duration = 0.09;
  const samples = Math.floor(sampleRate * duration);
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.exp(-45 * t);
    const tone = Math.sin(2 * Math.PI * 360 * t) + 0.35 * Math.sin(2 * Math.PI * 150 * t);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, tone * envelope)) * 28000, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
function playMoveSound() {
  unlockAudio();

  if (!audioContext) {
    if (!fallbackMoveAudio) return;
    const audio = fallbackMoveAudio.cloneNode();
    audio.volume = 0.5;
    audio.play().catch(() => {});
    return;
  }

  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.055);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.exponentialRampToValueAtTime(280, now + 0.08);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(now);
  osc.stop(now + 0.1);
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
    renderCapturedPiece(item);
    return;
  }

  if (!board.contains(item.el)) {
    board.appendChild(item.el);
  }

  if (activePiece?.dataset.id !== piece.id) {
    placePiece(item.el, piece.x, piece.y);
  }
}

function renderCapturedPiece(item) {
  const { el } = item;
  el.className = `captured-piece ${item.side}`;
  el.style.left = "";
  el.style.top = "";

  if (item.side === "red") {
    redCaptured.appendChild(el);
  } else if (item.side === "black") {
    blackCaptured.appendChild(el);
  }
}

function startDrag(event) {
  unlockAudio();
  activePiece = event.currentTarget;
  activePointerId = event.pointerId;
  activePointerPosition = { clientX: event.clientX, clientY: event.clientY };
  const item = pieces.get(activePiece.dataset.id);
  activeDragWasCaptured = Boolean(item?.captured);

  if (activeDragWasCaptured) {
    activePiece.className = `piece ${item.side}`;
    board.appendChild(activePiece);
  }

  activePiece.classList.add("dragging");
  activePiece.setPointerCapture(activePointerId);
  moveActivePiece(event);

  window.addEventListener("pointermove", moveActivePiece);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);
}

function moveActivePiece(event) {
  if (!activePiece || event.pointerId !== activePointerId) return;

  activePointerPosition = { clientX: event.clientX, clientY: event.clientY };
  autoScrollDuringDrag(event);

  const rect = board.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  activePiece.style.left = `${x}px`;
  activePiece.style.top = `${y}px`;
}

function autoScrollDuringDrag(event) {
  if (window.innerWidth > 720) return;

  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const edgeSize = 56;
  const scrollStep = 14;

  if (event.clientY < edgeSize) {
    window.scrollBy(0, -scrollStep);
  } else if (event.clientY > viewportHeight - edgeSize) {
    window.scrollBy(0, scrollStep);
  }
}

function finishDrag(event) {
  if (!activePiece || event.pointerId !== activePointerId) return;

  window.removeEventListener("pointermove", moveActivePiece);
  window.removeEventListener("pointerup", finishDrag);
  window.removeEventListener("pointercancel", finishDrag);
  if (activePiece.hasPointerCapture(activePointerId)) {
    activePiece.releasePointerCapture(activePointerId);
  }
  activePiece.classList.remove("dragging");

  const grid = pointerToGrid(event);
  const pieceId = activePiece.dataset.id;
  const item = pieces.get(pieceId);

  if (activeDragWasCaptured) {
    const canRestore = event.type !== "pointercancel" && isPointerInsideBoard(event) && isEmptyGrid(grid.x, grid.y);

    if (canRestore) {
      socket.emit("restore-piece", { roomId, pieceId, x: grid.x, y: grid.y });
    } else {
      renderCapturedPiece(item);
    }

    activePiece = null;
    activePointerId = null;
    activeDragWasCaptured = false;
    activePointerPosition = null;
    return;
  }


  const targetZone = getPointerZone(activePointerPosition) || getElementZone(activePiece) || getPointerZone(event);
  if (event.type !== "pointercancel" && targetZone === item.side) {
    // Keep the piece at its authoritative board position until the server
    // confirms the operation by broadcasting the updated room state.
    placePiece(activePiece, item.x, item.y);
    socket.emit("stow-piece", { roomId, pieceId });
    activePiece = null;
    activePointerId = null;
    activeDragWasCaptured = false;
    activePointerPosition = null;
    return;
  }

  if (event.type === "pointercancel" || !isPointerInsideBoard(event)) {
    placePiece(activePiece, item.x, item.y);
    activePiece = null;
    activePointerId = null;
    activeDragWasCaptured = false;
    activePointerPosition = null;
    return;
  }

  if (setupMode && !isEmptyGrid(grid.x, grid.y)) {
    placePiece(activePiece, item.x, item.y);
    activePiece = null;
    activePointerId = null;
    activeDragWasCaptured = false;
    activePointerPosition = null;
    return;
  }

  const didMove = item.x !== grid.x || item.y !== grid.y;
  item.x = grid.x;
  item.y = grid.y;
  placePiece(activePiece, grid.x, grid.y);

  if (didMove) {
    suppressNextMoveSound = true;
    playMoveSound();
  }

  socket.emit("move-piece", { roomId, pieceId, x: grid.x, y: grid.y });

  activePiece = null;
  activePointerId = null;
  activeDragWasCaptured = false;
  activePointerPosition = null;
}

function isPointerInsideBoard(event) {
  const rect = board.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function getElementZone(element) {
  const rect = element.getBoundingClientRect();
  const center = {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };

  if (isPointerInsideElement(center, redCaptured.closest(".captured-panel"))) return "red";
  if (isPointerInsideElement(center, blackCaptured.closest(".captured-panel"))) return "black";
  return null;
}

function getPointerZone(event) {
  if (isPointerInsideElement(event, redCaptured.closest(".captured-panel"))) return "red";
  if (isPointerInsideElement(event, blackCaptured.closest(".captured-panel"))) return "black";
  return null;
}

function isPointerInsideElement(event, element) {
  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function isEmptyGrid(x, y) {
  for (const item of pieces.values()) {
    if (!item.captured && item.x === x && item.y === y) return false;
  }

  return true;
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

function syncSetupControls() {
  if (setupMode && annotationMode) setAnnotationMode(false);
  setupButton.hidden = setupMode;
  setupActions.hidden = !setupMode;
  annotationModeButton.disabled = setupMode;
  undoButton.disabled = setupMode || undoButton.disabled;
  resetButton.disabled = setupMode;
  board.classList.toggle("setup-mode", setupMode);
}

function setAnnotationMode(enabled) {
  annotationMode = Boolean(enabled) && !setupMode;
  annotationModeButton.setAttribute("aria-pressed", String(annotationMode));
  annotationModeButton.textContent = annotationMode ? "退出讲解" : "讲解模式";
  annotationToolbar.hidden = !annotationMode;
  board.classList.toggle("annotation-mode", annotationMode);

  if (!annotationMode && annotationDraft) cancelAnnotationDraft();
  syncAnnotationControls();
}

function syncAnnotationControls() {
  annotationToolButtons.forEach((button) => {
    const active = button.dataset.tool === annotationTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  annotationColorButtons.forEach((button) => {
    const active = button.dataset.color === annotationColor;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const hasAnnotations = annotations.length > 0;
  undoAnnotationButton.disabled = !hasAnnotations;
  clearAnnotationsButton.disabled = !hasAnnotations;
}

function startAnnotation(event) {
  if (!annotationMode || event.button !== 0) return;
  event.preventDefault();

  annotationPointerId = event.pointerId;
  annotationLayer.setPointerCapture(annotationPointerId);
  const point = annotationPointFromPointer(event, true);

  annotationDraft = annotationTool === "circle"
    ? { type: "circle", color: annotationColor, x: point.x, y: point.y, r: 0.45 }
    : { type: "arrow", color: annotationColor, x1: point.x, y1: point.y, x2: point.x, y2: point.y };

  annotationLayer.addEventListener("pointermove", moveAnnotation);
  annotationLayer.addEventListener("pointerup", finishAnnotation);
  annotationLayer.addEventListener("pointercancel", cancelAnnotationDraft);
  renderAnnotations();
  sendAnnotationPreview(true);
}

function moveAnnotation(event) {
  if (!annotationDraft || event.pointerId !== annotationPointerId) return;
  event.preventDefault();
  const point = annotationPointFromPointer(event, annotationDraft.type === "arrow");

  if (annotationDraft.type === "arrow") {
    annotationDraft.x2 = point.x;
    annotationDraft.y2 = point.y;
  } else {
    const dx = point.x - annotationDraft.x;
    const dy = point.y - annotationDraft.y;
    annotationDraft.r = clamp(Math.sqrt(dx * dx + dy * dy), 0.35, 4);
  }

  renderAnnotations();
  sendAnnotationPreview();
}

function finishAnnotation(event) {
  if (!annotationDraft || event.pointerId !== annotationPointerId) return;
  const finished = annotationDraft;
  const isEmptyArrow = finished.type === "arrow" && finished.x1 === finished.x2 && finished.y1 === finished.y2;
  releaseAnnotationPointer();
  annotationDraft = null;
  socket.emit("annotation-preview", { roomId, annotation: null });

  if (!isEmptyArrow) {
    socket.emit("annotation-add", { roomId, annotation: finished });
  }
  renderAnnotations();
}

function cancelAnnotationDraft(event) {
  if (event?.pointerId !== undefined && event.pointerId !== annotationPointerId) return;
  releaseAnnotationPointer();
  annotationDraft = null;
  socket.emit("annotation-preview", { roomId, annotation: null });
  renderAnnotations();
}

function releaseAnnotationPointer() {
  annotationLayer.removeEventListener("pointermove", moveAnnotation);
  annotationLayer.removeEventListener("pointerup", finishAnnotation);
  annotationLayer.removeEventListener("pointercancel", cancelAnnotationDraft);
  if (annotationPointerId !== null && annotationLayer.hasPointerCapture(annotationPointerId)) {
    annotationLayer.releasePointerCapture(annotationPointerId);
  }
  annotationPointerId = null;
}

function annotationPointFromPointer(event, snapToGrid) {
  const rect = annotationLayer.getBoundingClientRect();
  let visualX = clamp(((event.clientX - rect.left) / rect.width) * 8, 0, 8);
  let visualY = clamp(((event.clientY - rect.top) / rect.height) * 9, 0, 9);
  if (snapToGrid) {
    visualX = Math.round(visualX);
    visualY = Math.round(visualY);
  }
  return visualToBoard(visualX, visualY);
}

function sendAnnotationPreview(immediate = false) {
  const now = performance.now();
  if (!immediate && now - lastPreviewSentAt < 45) return;
  lastPreviewSentAt = now;
  socket.emit("annotation-preview", { roomId, annotation: annotationDraft });
}

function renderAnnotations() {
  if (!annotationMarksGroup) return;
  annotationMarksGroup.replaceChildren();

  annotations.forEach((annotation) => {
    annotationMarksGroup.appendChild(createAnnotationElement(annotation));
  });

  remoteAnnotationDrafts.forEach((annotation) => {
    const element = createAnnotationElement(annotation);
    element.classList.add("remote-preview");
    annotationMarksGroup.appendChild(element);
  });

  if (annotationDraft) {
    const element = createAnnotationElement(annotationDraft);
    element.classList.add("local-preview");
    annotationMarksGroup.appendChild(element);
  }

  syncAnnotationControls();
}

function createAnnotationElement(annotation) {
  if (annotation.type === "circle") {
    const center = boardToVisual(annotation.x, annotation.y);
    const circle = createSvgElement("circle");
    circle.setAttribute("cx", center.x);
    circle.setAttribute("cy", center.y);
    circle.setAttribute("r", annotation.r);
    circle.setAttribute("stroke-width", "5");
    circle.setAttribute("class", `annotation-mark ${annotation.color}`);
    return circle;
  }

  const start = boardToVisual(annotation.x1, annotation.y1);
  const end = boardToVisual(annotation.x2, annotation.y2);
  const line = createSvgElement("line");
  line.setAttribute("x1", start.x);
  line.setAttribute("y1", start.y);
  line.setAttribute("x2", end.x);
  line.setAttribute("y2", end.y);
  line.setAttribute("stroke-width", "5");
  line.setAttribute("marker-end", `url(#annotation-arrow-${annotation.color})`);
  line.setAttribute("class", `annotation-mark ${annotation.color}`);
  return line;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}




