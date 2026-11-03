const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
const rooms = new Map();
const FRUITS = ["🍓", "🍋", "🍌", "🍇"];

function makeDeck() {
  const deck = [];
  // 14 cards per fruit: five 1-fruit cards, three 2-fruit,
  // three 3-fruit, two 4-fruit and one 5-fruit card.
  const counts = [[1,5],[2,3],[3,3],[4,2],[5,1]];
  for (const fruit of FRUITS) {
    for (const [amount, copies] of counts) {
      for (let i = 0; i < copies; i++) deck.push({ fruit, amount });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function publicState(room) {
  const players = room.players.map(p => ({
    id: p.id, name: p.name, count: p.deck.length,
    score: p.won.length, host: p.id === room.hostId
  }));
  return {
    code: room.code, status: room.status, players,
    turnIndex: room.turnIndex,
    activeCards: room.players.map(p => ({
      id: p.id, name: p.name, card: p.tableau.length ? p.tableau[p.tableau.length - 1] : null
    })),
    bellMessage: room.bellMessage || "",
    winner: room.winner || null
  };
}
function broadcast(room) {
  io.to(room.code).emit("state", publicState(room));
}
function fruitTotals(room) {
  const totals = Object.fromEntries(FRUITS.map(f => [f, 0]));
  room.players.forEach(p => {
    if (p.tableau.length) { const top = p.tableau[p.tableau.length - 1]; totals[top.fruit] += top.amount; }
  });
  return totals;
}
function hasFive(room) {
  return Object.values(fruitTotals(room)).some(n => n === 5);
}
function finishIfNeeded(room) {
  const alive = room.players.filter(p => p.deck.length > 0);
  if (alive.length <= 1) {
    room.status = "finished";
    const ranked = [...room.players].sort((a,b) => b.won.length - a.won.length);
    room.winner = ranked[0] ? ranked[0].name : "없음";
    return true;
  }
  return false;
}
function roomFor(socket) {
  const roomCode = socket.data.roomCode;
  return roomCode && rooms.get(roomCode);
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}) => {
    name = String(name || "").trim().slice(0, 14);
    if (!name) return socket.emit("errorMessage", "닉네임을 입력해 주세요.");
    let roomCode;
    do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, hostId: socket.id, status: "lobby",
      players: [{id: socket.id, name, deck: [], won: [], tableau: []}],
      turnIndex: 0, bellMessage: ""
    };
    rooms.set(roomCode, room);
    socket.join(roomCode); socket.data.roomCode = roomCode;
    socket.emit("joined", {code: roomCode, playerId: socket.id});
    broadcast(room);
  });

  socket.on("joinRoom", ({name, code: inputCode}) => {
    const nameClean = String(name || "").trim().slice(0, 14);
    const roomCode = String(inputCode || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!nameClean) return socket.emit("errorMessage", "닉네임을 입력해 주세요.");
    if (!room) return socket.emit("errorMessage", "방 코드를 확인해 주세요.");
    if (room.status !== "lobby") return socket.emit("errorMessage", "이미 게임이 시작된 방입니다.");
    if (room.players.length >= 4) return socket.emit("errorMessage", "방이 가득 찼습니다. (최대 4명)");
    room.players.push({id: socket.id, name: nameClean, deck: [], won: [], tableau: []});
    socket.join(roomCode); socket.data.roomCode = roomCode;
    socket.emit("joined", {code: roomCode, playerId: socket.id});
    broadcast(room);
  });

  socket.on("startGame", () => {
    const room = roomFor(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== "lobby" || room.players.length < 2) {
      return socket.emit("errorMessage", "게임은 2명 이상 모였을 때 시작할 수 있어요.");
    }
    const deck = makeDeck();
    room.players.forEach(p => { p.deck = []; p.won = []; p.tableau = []; });
    deck.forEach((card, i) => room.players[i % room.players.length].deck.push(card));
    // Keep each player's deck in draw order.
    room.players.forEach(p => p.deck.reverse());
    room.status = "playing"; room.turnIndex = 0; room.bellMessage = "";
    broadcast(room);
  });

  socket.on("flipCard", () => {
    const room = roomFor(socket);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.deck.length === 0 || player.faceUp) return;
    const current = room.players[room.turnIndex % room.players.length];
    if (current.id !== socket.id) return socket.emit("errorMessage", "아직 내 차례가 아니에요.");
    player.tableau.push(player.deck.pop());
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    room.bellMessage = "";
    finishIfNeeded(room);
    broadcast(room);
  });

  socket.on("ringBell", () => {
    const room = roomFor(socket);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (hasFive(room)) {
      const collected = [];
      room.players.forEach(p => {
        if (p.tableau.length) { collected.push(...p.tableau); p.tableau = []; }
      });
      // Award the visible cards to the fastest valid bell-ringer.
      player.won.push(...collected);
      room.bellMessage = `${player.name} 님이 종을 가장 먼저 눌러 공개 카드를 가져갔어요!`;
    } else {
      // Simple digital penalty: one card from the offender's draw pile to each opponent.
      let penalty = 0;
      room.players.forEach(p => {
        if (p.id !== player.id && player.deck.length > 0) {
          p.won.push(player.deck.pop()); penalty++;
        }
      });
      room.bellMessage = `${player.name} 님의 오답! 상대에게 카드 ${penalty}장을 나눠줬어요.`;
    }
    finishIfNeeded(room);
    broadcast(room);
  });

  socket.on("restartGame", () => {
    const room = roomFor(socket);
    if (!room || room.hostId !== socket.id) return;
    room.status = "lobby"; room.winner = null; room.bellMessage = "";
    room.turnIndex = 0;
    room.players.forEach(p => { p.deck = []; p.won = []; p.tableau = []; });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = roomFor(socket);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) rooms.delete(room.code);
    else {
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      if (room.status === "playing") {
        room.status = "finished";
        room.winner = "참가자 연결이 끊겨 게임이 종료됐어요";
      }
      broadcast(room);
    }
  });
});

server.listen(PORT, () => console.log(`Halli Galli Online running on ${PORT}`));
