const { Server } = require("socket.io");

const io = new Server(3000, {
  cors: { origin: "*" },
});

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_PLAYERS = 15;
const MIN_PLAYERS = 3;
const COUNTDOWN_SECS = 10;
const DAY_SECS = 60;
const NIGHT_SECS = 30;
const VOTE_SECS = 40;

// ─── Name / Color Pools ───────────────────────────────────────────────────────
const ADJECTIVES = ["Red","Blue","Dark","Swift","Silent","Fierce","Crazy","Mighty","Rapid","Shadow","Lucky","Iron","Wild","Brave","Golden","Silver","Crimson","Jade","Ashen","Frost"];
const NOUNS = ["Tiger","Falcon","Wolf","Knight","Wizard","Ninja","Phoenix","Dragon","Ranger","Samurai","Viking","Panther","Eagle","Shark","Raven","Cobra","Lynx","Viper"];
const COLORS = ["#e63946","#2ec4b6","#f4a261","#a8dadc","#e9c46a","#52b788","#c77dff","#ff6b6b","#48cae4","#ffd166","#06d6a0","#ef476f","#118ab2","#fca311"];

const takenNames = new Set();
const takenColors = new Set();

function pickUnique(pool, taken) {
  const available = pool.filter(x => !taken.has(x));
  if (available.length === 0) return pool[Math.floor(Math.random() * pool.length)];
  const pick = available[Math.floor(Math.random() * available.length)];
  taken.add(pick);
  return pick;
}

function generateName() {
  let name;
  let attempts = 0;
  do {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    name = `${adj}${noun}`;
    attempts++;
    if (attempts > 100) { name += Math.floor(Math.random() * 999); break; }
  } while (takenNames.has(name));
  takenNames.add(name);
  return name;
}

function generateColor() {
  return pickUnique(COLORS, takenColors);
}

// ─── Room State ───────────────────────────────────────────────────────────────
// rooms: Map<roomCode, GameState>
// GameState: {
//   players: Map<socketId, PlayerObj>,
//   phase: "lobby"|"countdown"|"day"|"night"|"voting"|"over",
//   killerTarget: socketId | null,
//   medicTarget:  socketId | null,
//   votes: Map<targetId, Set<voterId>>,
//   timers: Set<intervalId>,
//   host: socketId
// }
const rooms = new Map();

function createRoom(hostId) {
  return {
    players: new Map(),
    phase: "lobby",
    killerTarget: null,
    medicTarget: null,
    votes: new Map(),
    timers: new Set(),
    host: hostId,
  };
}

function clearTimers(room) {
  const game = rooms.get(room);
  if (!game) return;
  game.timers.forEach(t => clearInterval(t));
  game.timers.clear();
}

function roomPlayerList(game) {
  return Array.from(game.players.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    color: p.color,
    alive: p.alive,
    role: null, // never leak roles to client broadcast
  }));
}

function privateRoleList(game, requesterId) {
  const requester = game.players.get(requesterId);
  return Array.from(game.players.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    color: p.color,
    alive: p.alive,
    // killer sees other killer (only themselves), medic sees no one else's role
    role: (id === requesterId) ? p.role : null,
  }));
}

// ─── Win Check ────────────────────────────────────────────────────────────────
function checkWin(room) {
  const game = rooms.get(room);
  if (!game) return true;

  const alive = [...game.players.values()].filter(p => p.alive);
  const killerAlive = alive.some(p => p.role === "killer");

  if (!killerAlive) {
    endGame(room, "civilians");
    return true;
  }
  // Killer wins when they're >= half the remaining players (classic Mafia rule)
  const killerCount = alive.filter(p => p.role === "killer").length;
  if (killerCount >= alive.length - killerCount) {
    endGame(room, "killer");
    return true;
  }
  return false;
}

function endGame(room, winner) {
  const game = rooms.get(room);
  if (!game) return;
  clearTimers(room);
  game.phase = "over";

  // reveal all roles
  const reveal = Array.from(game.players.entries()).map(([id, p]) => ({
    id, name: p.name, color: p.color, alive: p.alive, role: p.role,
  }));

  io.to(room).emit("game-over", { winner, players: reveal });
}

// ─── Game Flow ────────────────────────────────────────────────────────────────
function startGame(room) {
  const game = rooms.get(room);
  if (!game) return;

  clearTimers(room);
  game.phase = "day";
  game.killerTarget = null;
  game.medicTarget = null;
  game.votes = new Map();

  const ids = [...game.players.keys()];
  // Shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  game.players.get(ids[0]).role = "killer";
  game.players.get(ids[1]).role = "medic";
  for (let i = 2; i < ids.length; i++) game.players.get(ids[i]).role = "civilian";

  // Send each player their private role
  for (const [id, player] of game.players) {
    io.to(id).emit("your-role", { role: player.role, name: player.name });
  }

  // Broadcast public player list (no roles)
  io.to(room).emit("player-list", roomPlayerList(game));

  startDayPhase(room);
}

function startDayPhase(room) {
  const game = rooms.get(room);
  if (!game) return;
  game.phase = "day";
  game.killerTarget = null;
  game.medicTarget = null;
  game.votes = new Map();

  let t = DAY_SECS;
  io.to(room).emit("phase-change", { phase: "day", timeLeft: t });

  const iv = setInterval(() => {
    t--;
    io.to(room).emit("timer-tick", t);
    if (t <= 0) {
      clearInterval(iv);
      game.timers.delete(iv);
      startNightPhase(room);
    }
  }, 1000);
  game.timers.add(iv);
}

function startNightPhase(room) {
  const game = rooms.get(room);
  if (!game) return;
  if (checkWin(room)) return;

  game.phase = "night";
  game.killerTarget = null;
  game.medicTarget = null;

  const playerList = roomPlayerList(game);
  let t = NIGHT_SECS;

  io.to(room).emit("phase-change", { phase: "night", timeLeft: t, players: playerList });

  const iv = setInterval(() => {
    t--;
    io.to(room).emit("timer-tick", t);
    if (t <= 0) {
      clearInterval(iv);
      game.timers.delete(iv);
      resolveNight(room);
    }
  }, 1000);
  game.timers.add(iv);
}

function resolveNight(room) {
  const game = rooms.get(room);
  if (!game) return;

  let killedId = null;
  let saved = false;

  if (game.killerTarget) {
    if (game.killerTarget === game.medicTarget) {
      saved = true;
      io.to(room).emit("night-result", { saved: true, killedName: null });
    } else {
      killedId = game.killerTarget;
      const killed = game.players.get(killedId);
      if (killed) {
        killed.alive = false;
        io.to(room).emit("night-result", {
          saved: false,
          killedId,
          killedName: killed.name,
          killedRole: killed.role,
        });
      }
    }
  } else {
    io.to(room).emit("night-result", { saved: false, killedId: null, killedName: null });
  }

  if (checkWin(room)) return;

  // Update public list
  io.to(room).emit("player-list", roomPlayerList(game));

  // Move to voting
  setTimeout(() => startVotingPhase(room), 2500);
}

function startVotingPhase(room) {
  const game = rooms.get(room);
  if (!game) return;

  game.phase = "voting";
  game.votes = new Map();

  const alivePlayers = roomPlayerList(game).filter(p => p.alive);
  let t = VOTE_SECS;

  io.to(room).emit("phase-change", { phase: "voting", timeLeft: t, players: alivePlayers });

  const iv = setInterval(() => {
    t--;
    io.to(room).emit("timer-tick", t);
    if (t <= 0) {
      clearInterval(iv);
      game.timers.delete(iv);
      resolveVoting(room);
    }
  }, 1000);
  game.timers.add(iv);
}

function resolveVoting(room) {
  const game = rooms.get(room);
  if (!game) return;

  // Tally votes
  let maxVotes = 0;
  let eliminated = null;

  for (const [targetId, voters] of game.votes) {
    if (voters.size > maxVotes) {
      maxVotes = voters.size;
      eliminated = targetId;
    }
  }

  if (eliminated && game.players.has(eliminated)) {
    const player = game.players.get(eliminated);
    player.alive = false;
    io.to(room).emit("vote-result", {
      eliminatedId: eliminated,
      eliminatedName: player.name,
      eliminatedRole: player.role,
      voteCount: maxVotes,
    });
  } else {
    io.to(room).emit("vote-result", { eliminatedId: null, eliminatedName: null });
  }

  if (checkWin(room)) return;

  io.to(room).emit("player-list", roomPlayerList(game));

  setTimeout(() => startDayPhase(room), 3000);
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
let onlineCount = 0;

io.on("connection", (socket) => {
  socket.username = generateName();
  socket.color = generateColor();
  socket.currentRoom = null;

  onlineCount++;
  io.emit("online-count", onlineCount);

  socket.emit("your-identity", { name: socket.username, color: socket.color });

  // ── Chat ──
  socket.on("send-message", ({ text, room }) => {
    if (!text || text.trim().length === 0) return;
    const safeText = text.trim().slice(0, 300);
    const payload = { text: safeText, sender: socket.username, color: socket.color, id: socket.id };

    if (room) {
      io.to(room).emit("receive-message", payload);
    } else {
      io.emit("receive-message", payload);
    }
  });

  // ── Join Room ──
  socket.on("join-room", (rawCode, cb) => {
    const code = String(rawCode).trim().slice(0, 10);
    if (!code) return cb({ success: false, message: "Invalid room code" });

    const currentSize = io.sockets.adapter.rooms.get(code)?.size || 0;
    if (currentSize >= MAX_PLAYERS) return cb({ success: false, message: "Room is full" });

    // Leave current room first
    if (socket.currentRoom) leaveRoom(socket);

    socket.join(code);
    socket.currentRoom = code;

    if (!rooms.has(code)) {
      rooms.set(code, createRoom(socket.id));
    }

    const game = rooms.get(code);

    if (game.phase !== "lobby") {
      socket.leave(code);
      socket.currentRoom = null;
      return cb({ success: false, message: "Game already in progress" });
    }

    game.players.set(socket.id, {
      name: socket.username,
      color: socket.color,
      role: null,
      alive: true,
    });

    const newCount = io.sockets.adapter.rooms.get(code)?.size || 1;
    io.to(code).emit("room-player-count", { count: newCount, max: MAX_PLAYERS });
    io.to(code).emit("lobby-players", roomPlayerList(game));

    cb({ success: true, message: `Joined room ${code}`, isHost: game.host === socket.id });
  });

  // ── Start Game ──
  socket.on("start-game", () => {
    const room = socket.currentRoom;
    const game = rooms.get(room);
    if (!game || game.phase !== "lobby") return;
    if (game.host !== socket.id) {
      socket.emit("error-msg", "Only the host can start the game");
      return;
    }
    if (game.players.size < MIN_PLAYERS) {
      socket.emit("error-msg", `Need at least ${MIN_PLAYERS} players to start`);
      return;
    }

    game.phase = "countdown";
    let t = COUNTDOWN_SECS;
    io.to(room).emit("game-countdown", t);

    const iv = setInterval(() => {
      t--;
      io.to(room).emit("game-countdown", t);
      if (t <= 0) {
        clearInterval(iv);
        game.timers.delete(iv);
        startGame(room);
      }
    }, 1000);
    game.timers.add(iv);
  });

  // ── Night Action (killer/medic pick) ──
  socket.on("night-action", (targetId) => {
    const room = socket.currentRoom;
    const game = rooms.get(room);
    if (!game || game.phase !== "night") return;

    const actor = game.players.get(socket.id);
    const target = game.players.get(targetId);
    if (!actor || !actor.alive || !target || !target.alive) return;

    if (actor.role === "killer") {
      if (targetId === socket.id) return; // can't self-target
      game.killerTarget = targetId;
      socket.emit("action-confirmed", { action: "kill", targetName: target.name });
    } else if (actor.role === "medic") {
      game.medicTarget = targetId;
      socket.emit("action-confirmed", { action: "save", targetName: target.name });
    }
  });

  // ── Vote ──
  socket.on("vote", (targetId) => {
    const room = socket.currentRoom;
    const game = rooms.get(room);
    if (!game || game.phase !== "voting") return;

    const voter = game.players.get(socket.id);
    const target = game.players.get(targetId);
    if (!voter || !voter.alive || !target || !target.alive) return;

    // Remove previous vote by this voter
    for (const [tid, voters] of game.votes) {
      voters.delete(socket.id);
      if (voters.size === 0) game.votes.delete(tid);
    }

    if (!game.votes.has(targetId)) game.votes.set(targetId, new Set());
    game.votes.get(targetId).add(socket.id);

    // Broadcast updated vote tallies (anonymised — just counts)
    const tally = Array.from(game.votes.entries()).map(([tid, voters]) => ({
      targetId: tid,
      count: voters.size,
    }));
    io.to(room).emit("vote-update", tally);
  });

  // ── Change Name ──
  socket.on("change-name", (newName, cb) => {
    newName = String(newName).trim().slice(0, 20);
    if (!newName) return cb({ success: false, message: "Name cannot be empty" });
    if (takenNames.has(newName)) return cb({ success: false, message: "Name already taken" });

    takenNames.delete(socket.username);
    takenNames.add(newName);
    socket.username = newName;

    // Update in room if present
    if (socket.currentRoom) {
      const game = rooms.get(socket.currentRoom);
      if (game?.players.has(socket.id)) {
        game.players.get(socket.id).name = newName;
      }
    }

    cb({ success: true, name: newName });
  });

  // ── Disconnect ──
  socket.on("disconnecting", () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit("online-count", onlineCount);
    takenNames.delete(socket.username);
    takenColors.delete(socket.color);
    if (socket.currentRoom) leaveRoom(socket, true);
  });

  function leaveRoom(socket, disconnecting = false) {
    const room = socket.currentRoom;
    const game = rooms.get(room);
    if (!game) return;

    game.players.delete(socket.id);
    if (!disconnecting) socket.leave(room);
    socket.currentRoom = null;

    if (game.players.size === 0) {
      clearTimers(room);
      rooms.delete(room);
      return;
    }

    // Transfer host if needed
    if (game.host === socket.id) {
      game.host = game.players.keys().next().value;
      io.to(game.host).emit("you-are-host");
    }

    const count = io.sockets.adapter.rooms.get(room)?.size || 0;
    io.to(room).emit("room-player-count", { count, max: MAX_PLAYERS });
    io.to(room).emit("lobby-players", roomPlayerList(game));
    io.to(room).emit("receive-message", {
      text: `${socket.username} left the room`,
      sender: "System",
      color: "#888",
      id: "system",
    });
  }
});

console.log("🎭 Mafia server running on port 3000");
