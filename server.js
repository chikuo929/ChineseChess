const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function initialPieces() {
  return [
    piece("black-car-1", "black", "\u8f66", 0, 0),
    piece("black-horse-1", "black", "\u9a6c", 1, 0),
    piece("black-elephant-1", "black", "\u8c61", 2, 0),
    piece("black-advisor-1", "black", "\u58eb", 3, 0),
    piece("black-general", "black", "\u5c06", 4, 0),
    piece("black-advisor-2", "black", "\u58eb", 5, 0),
    piece("black-elephant-2", "black", "\u8c61", 6, 0),
    piece("black-horse-2", "black", "\u9a6c", 7, 0),
    piece("black-car-2", "black", "\u8f66", 8, 0),
    piece("black-cannon-1", "black", "\u70ae", 1, 2),
    piece("black-cannon-2", "black", "\u70ae", 7, 2),
    piece("black-soldier-1", "black", "\u5352", 0, 3),
    piece("black-soldier-2", "black", "\u5352", 2, 3),
    piece("black-soldier-3", "black", "\u5352", 4, 3),
    piece("black-soldier-4", "black", "\u5352", 6, 3),
    piece("black-soldier-5", "black", "\u5352", 8, 3),
    piece("red-car-1", "red", "\u8f66", 0, 9),
    piece("red-horse-1", "red", "\u9a6c", 1, 9),
    piece("red-elephant-1", "red", "\u76f8", 2, 9),
    piece("red-advisor-1", "red", "\u4ed5", 3, 9),
    piece("red-general", "red", "\u5e05", 4, 9),
    piece("red-advisor-2", "red", "\u4ed5", 5, 9),
    piece("red-elephant-2", "red", "\u76f8", 6, 9),
    piece("red-horse-2", "red", "\u9a6c", 7, 9),
    piece("red-car-2", "red", "\u8f66", 8, 9),
    piece("red-cannon-1", "red", "\u70ae", 1, 7),
    piece("red-cannon-2", "red", "\u70ae", 7, 7),
    piece("red-soldier-1", "red", "\u5175", 0, 6),
    piece("red-soldier-2", "red", "\u5175", 2, 6),
    piece("red-soldier-3", "red", "\u5175", 4, 6),
    piece("red-soldier-4", "red", "\u5175", 6, 6),
    piece("red-soldier-5", "red", "\u5175", 8, 6)
  ];
}

function piece(id, side, name, x, y) {
  return { id, side, name, x, y, captured: false, capturedBy: null };
}

function createRoom() {
  return { pieces: initialPieces(), history: [] };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom());
  }

  return rooms.get(roomId);
}

function publicRoom(room) {
  return {
    pieces: room.pieces,
    canUndo: room.history.length > 0
  };
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/room/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  let currentRoomId = null;

  socket.on("join-room", (roomId) => {
    currentRoomId = String(roomId || "default").trim() || "default";
    socket.join(currentRoomId);

    const room = getRoom(currentRoomId);
    socket.emit("room-state", publicRoom(room));
    emitPlayerCount(currentRoomId);
  });

  socket.on("move-piece", ({ roomId, pieceId, x, y }) => {
    const targetRoomId = String(roomId || currentRoomId || "default");
    const room = getRoom(targetRoomId);
    const targetPiece = room.pieces.find((item) => item.id === pieceId);

    if (!targetPiece || targetPiece.captured) return;

    const nextX = clamp(Number(x), 0, 8);
    const nextY = clamp(Number(y), 0, 9);
    if (targetPiece.x === nextX && targetPiece.y === nextY) return;

    room.history.push(clonePieces(room.pieces));
    if (room.history.length > 80) {
      room.history.shift();
    }

    const capturedPiece = room.pieces.find((item) => {
      return !item.captured && item.id !== pieceId && item.side !== targetPiece.side && item.x === nextX && item.y === nextY;
    });

    if (capturedPiece) {
      capturedPiece.captured = true;
      capturedPiece.capturedBy = targetPiece.side;
      capturedPiece.x = null;
      capturedPiece.y = null;
    }

    targetPiece.x = nextX;
    targetPiece.y = nextY;
    io.to(targetRoomId).emit("room-state", publicRoom(room));
  });

  socket.on("undo", (roomId) => {
    const targetRoomId = String(roomId || currentRoomId || "default");
    const room = getRoom(targetRoomId);
    const previousPieces = room.history.pop();

    if (!previousPieces) return;
    room.pieces = previousPieces;
    io.to(targetRoomId).emit("room-state", publicRoom(room));
  });

  socket.on("reset-board", (roomId) => {
    const targetRoomId = String(roomId || currentRoomId || "default");
    const room = getRoom(targetRoomId);
    room.pieces = initialPieces();
    room.history = [];
    io.to(targetRoomId).emit("room-state", publicRoom(room));
  });

  socket.on("disconnect", () => {
    if (!currentRoomId) return;
    emitPlayerCount(currentRoomId);
  });
});

function emitPlayerCount(roomId) {
  io.to(roomId).emit("player-count", io.sockets.adapter.rooms.get(roomId)?.size || 0);
}

function clonePieces(pieces) {
  return pieces.map((item) => ({ ...item }));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

server.listen(PORT, () => {
  console.log(`Xiangqi room server is running at http://localhost:${PORT}`);
});



