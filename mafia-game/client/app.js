const socket = io("https://mafiarevamp.onrender.com");

const state = {
  myId: null,
  myName: null,
  myColor: null,
  myRole: null,
  currentRoom: null,
  isHost: false,
  phase: null,
  players: [],        // [{id, name, color, alive, role}]
  timerMax: 60,
  selectedTarget: null,
  hasActed: false,
  hasVoted: false,
};

const $ = id => document.getElementById(id);
const screens = { lobby: $("screen-lobby"), game: $("screen-game") };

const lobbyName       = $("lobby-name");
const lobbyAvatar     = $("lobby-avatar");
const onlineCount     = $("online-count");
const panelHome       = $("panel-home");
const panelRoom       = $("panel-room");
const renameBox       = $("rename-box");
const renameInput     = $("rename-input");
const joinBox         = $("join-box");
const joinCodeInput   = $("join-code-input");
const roomCodeDisplay = $("room-code-display");
const roomCountDisp   = $("room-count-display");
const lobbyPlayerList = $("lobby-player-list");
const btnStart        = $("btn-start");
const hostHint        = $("host-hint");
const chatScope       = $("chat-scope");
const messages        = $("messages");
const chatInput       = $("chat-input");

const playerGrid      = $("player-grid");
const phaseName       = $("phase-name");
const phaseIcon       = $("phase-icon");
const timerBar        = $("timer-bar");
const timerText       = $("timer-text");
const roleName        = $("role-name");
const roleIcon        = $("role-icon");
const roleBadge       = $("role-badge");
const actionPrompt    = $("action-prompt");
const actionButtons   = $("action-buttons");
const civilianNight   = $("civilian-night");
const resultFlash     = $("result-flash");
const gameMessages    = $("game-messages");
const gameChatInput   = $("game-chat-input");
const gameOnline      = $("game-online");

const countdownOverlay = $("countdown-overlay");
const countdownNum     = $("countdown-num");
const roleOverlay      = $("role-overlay");
const revealIcon       = $("reveal-icon");
const revealRole       = $("reveal-role");
const revealDesc       = $("reveal-desc");
const gameoverOverlay  = $("gameover-overlay");
const gameoverLabel    = $("gameover-label");
const gameoverTitle    = $("gameover-title");
const gameoverPlayers  = $("gameover-players");

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
}

function setAvatar(el, color, name) {
  el.style.background = color || "#333";
  el.title = name || "";
}

function colorAvatar(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function addMessage(container, { text, sender, color, id }) {
  const div = document.createElement("div");
  div.className = "chat-message" + (id === "system" ? " system" : "");
  if (id === "system") {
    div.textContent = text;
  } else {
    div.innerHTML = `<span class="sender" style="color:${color || "#aaa"}">${escHtml(sender)}</span>: ${escHtml(text)}`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function showOverlay(el)  { el.classList.remove("hidden"); }
function hideOverlay(el)  { el.classList.add("hidden"); }

function setPhaseUI(phase, timeLeft, max) {
  state.phase = phase;
  state.timerMax = max || timeLeft;

  const icons   = { day: "☀️", night: "🌙", voting: "⚖️", countdown: "⏳" };
  const labels  = { day: "Day", night: "Night", voting: "Vote", countdown: "Starting" };
  phaseIcon.textContent = icons[phase] || "•";
  phaseName.textContent = labels[phase] || phase;

  const hud = document.querySelector(".game-hud");
  hud.className = `game-hud phase-${phase}`;

  updateTimer(timeLeft, max || timeLeft);
}

function updateTimer(t, max) {
  const pct = max > 0 ? (t / max) * 100 : 0;
  timerBar.style.width = pct + "%";
  timerText.textContent = `${t}s`;

  if (pct < 25) timerBar.style.background = "var(--red-light)";
  else if (pct < 50) timerBar.style.background = "var(--gold)";
}

function renderPlayerGrid(clickable = false) {
  playerGrid.innerHTML = "";
  const alive = state.players.filter(p => p.alive).length;
  gameOnline.textContent = `● ${alive} alive`;

  state.players.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.dataset.id = p.id;

    if (!p.alive) card.classList.add("dead");
    if (p.id === socket.id) card.classList.add("self");
    if (clickable && p.alive && p.id !== socket.id) card.classList.add("clickable");
    if (p.id === state.selectedTarget) card.classList.add("selected");

    const av = document.createElement("div");
    av.className = "player-card-avatar";
    av.style.background = p.color || colorAvatar(p.name);
    card.appendChild(av);

    const nm = document.createElement("div");
    nm.className = "player-card-name";
    nm.textContent = p.name + (p.id === socket.id ? " (you)" : "");
    card.appendChild(nm);

    if (p.role) {
      const rl = document.createElement("div");
      rl.className = "player-card-role";
      rl.textContent = p.role;
      card.appendChild(rl);
    }

    if (clickable && p.alive && p.id !== socket.id) {
      card.addEventListener("click", () => onPlayerCardClick(p.id));
    }

    playerGrid.appendChild(card);
  });
}

function onPlayerCardClick(targetId) {
  if (state.phase === "night") {
    if (state.hasActed) return;
    state.selectedTarget = targetId;
    renderPlayerGrid(true);
    socket.emit("night-action", targetId);
  } else if (state.phase === "voting") {
    state.selectedTarget = targetId;
    renderPlayerGrid(true);
    socket.emit("vote", targetId);
  }
}

function flashResult(html, color) {
  resultFlash.innerHTML = html;
  resultFlash.style.borderLeft = `3px solid ${color || "var(--gold)"}`;
  resultFlash.classList.remove("hidden");
  setTimeout(() => resultFlash.classList.add("hidden"), 4000);
}

function setActionArea(phase, role) {
  actionButtons.innerHTML = "";
  civilianNight.classList.add("hidden");
  actionPanel.classList.remove("hidden");

  if (phase === "day") {
    actionPrompt.textContent = "The town gathers… Discuss and prepare your case.";
    actionButtons.innerHTML = "";
  } else if (phase === "night") {
    if (role === "killer") {
      actionPrompt.textContent = "🔪 Choose your target. The town sleeps.";
    } else if (role === "medic") {
      actionPrompt.textContent = "💊 Choose someone to protect tonight.";
    } else {
      actionPanel.classList.add("hidden");
      civilianNight.classList.remove("hidden");
    }
  } else if (phase === "voting") {
    actionPrompt.textContent = "⚖️ Vote to eliminate who you think the killer is.";
  }
}

$("btn-rename").addEventListener("click", () => {
  renameBox.classList.toggle("hidden");
  renameInput.focus();
});

$("btn-rename-confirm").addEventListener("click", () => {
  const name = renameInput.value.trim();
  if (!name) return;
  socket.emit("change-name", name, ({ success, message, name: newName }) => {
    if (success) {
      state.myName = newName;
      lobbyName.textContent = newName;
      renameBox.classList.add("hidden");
      renameInput.value = "";
    } else {
      addMessage(messages, { text: message, sender: "System", color: "#888", id: "system" });
    }
  });
});

$("btn-create").addEventListener("click", () => {
  const code = Math.floor(10000 + Math.random() * 89999).toString();
  socket.emit("join-room", code, (res) => {
    if (res.success) {
      state.currentRoom = code;
      state.isHost = res.isHost;
      showRoomPanel(code);
    } else {
      addMessage(messages, { text: res.message, sender: "System", color: "#888", id: "system" });
    }
  });
});

$("btn-join-open").addEventListener("click", () => {
  joinBox.classList.toggle("hidden");
  joinCodeInput.focus();
});

$("btn-join-confirm").addEventListener("click", doJoin);
joinCodeInput.addEventListener("keydown", e => { if (e.key === "Enter") doJoin(); });

function doJoin() {
  const code = joinCodeInput.value.trim();
  if (!code) return;
  socket.emit("join-room", code, (res) => {
    if (res.success) {
      state.currentRoom = code;
      state.isHost = res.isHost;
      joinCodeInput.value = "";
      joinBox.classList.add("hidden");
      showRoomPanel(code);
    } else {
      addMessage(messages, { text: res.message, sender: "System", color: "#888", id: "system" });
    }
  });
}

function showRoomPanel(code) {
  panelHome.classList.add("hidden");
  panelRoom.classList.remove("hidden");
  roomCodeDisplay.textContent = code;
  chatScope.textContent = `Room ${code}`;
  updateHostUI();
}

function updateHostUI() {
  if (state.isHost) {
    btnStart.classList.remove("hidden");
    hostHint.classList.add("hidden");
  } else {
    btnStart.classList.add("hidden");
    hostHint.classList.remove("hidden");
  }
}

$("btn-leave").addEventListener("click", () => {
  state.currentRoom = null;
  state.isHost = false;
  panelRoom.classList.add("hidden");
  panelHome.classList.remove("hidden");
  chatScope.textContent = "Global";
  socket.emit("join-room", "__leave__"); 
  window.location.reload();
});

btnStart.addEventListener("click", () => {
  socket.emit("start-game");
});

function sendChat(inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  socket.emit("send-message", { text, room: state.currentRoom || "" });
  inputEl.value = "";
}

chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(chatInput); });
$("btn-send").addEventListener("click", () => sendChat(chatInput));
gameChatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(gameChatInput); });
$("btn-game-send").addEventListener("click", () => sendChat(gameChatInput));

document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== chatInput && document.activeElement !== gameChatInput) {
    e.preventDefault();
    const activeInput = screens.game.classList.contains("active") ? gameChatInput : chatInput;
    activeInput.focus();
  }
});

socket.on("your-identity", ({ name, color }) => {
  state.myId = socket.id;
  state.myName = name;
  state.myColor = color;
  lobbyName.textContent = name;
  setAvatar(lobbyAvatar, color, name);
});

socket.on("online-count", (n) => {
  onlineCount.textContent = `● ${n} Online`;
});

socket.on("room-player-count", ({ count, max }) => {
  roomCountDisp.textContent = `${count}/${max}`;
});

socket.on("lobby-players", (players) => {
  lobbyPlayerList.innerHTML = "";
  players.forEach(p => {
    const item = document.createElement("div");
    item.className = "lobby-player-item";

    const dot = document.createElement("div");
    dot.className = "lobby-player-dot";
    dot.style.background = p.color || colorAvatar(p.name);
    item.appendChild(dot);

    const nm = document.createElement("span");
    nm.textContent = p.name + (p.id === socket.id ? " (you)" : "");
    item.appendChild(nm);

    item.appendChild(dot);
    item.insertBefore(nm, null);

    lobbyPlayerList.appendChild(item);
  });
});

socket.on("you-are-host", () => {
  state.isHost = true;
  updateHostUI();
  addMessage(messages, { text: "You are now the host.", sender: "System", color: "#888", id: "system" });
});

socket.on("receive-message", (msg) => {
  addMessage(messages, msg);
  if (screens.game.classList.contains("active")) {
    addMessage(gameMessages, msg);
  }
});

socket.on("error-msg", (msg) => {
  addMessage(messages, { text: msg, sender: "System", color: "var(--red-light)", id: "system" });
});

socket.on("game-countdown", (t) => {
  showOverlay(countdownOverlay);
  countdownNum.textContent = t;
  if (t <= 0) hideOverlay(countdownOverlay);
});

socket.on("your-role", ({ role }) => {
  state.myRole = role;
  hideOverlay(countdownOverlay);

  const roleData = {
    killer:   { icon: "🔪", label: "KILLER",   desc: "Each night, choose a player to eliminate. Outlast them all.", color: "var(--red-light)" },
    medic:    { icon: "💊", label: "MEDIC",    desc: "Each night, choose a player to protect from the killer.",     color: "var(--teal)" },
    civilian: { icon: "👤", label: "CIVILIAN", desc: "Find the killer through discussion and voting. Trust no one.", color: "var(--text-dim)" },
  };
  const rd = roleData[role] || { icon: "?", label: role.toUpperCase(), desc: "", color: "var(--gold)" };

  revealIcon.textContent = rd.icon;
  revealRole.textContent = rd.label;
  revealRole.style.color = rd.color;
  revealDesc.textContent = rd.desc;

  showOverlay(roleOverlay);
  showScreen("game");

  roleIcon.textContent = rd.icon;
  roleName.textContent = rd.label;
  roleBadge.className = `role-badge role-${role}`;
});

$("btn-role-dismiss").addEventListener("click", () => hideOverlay(roleOverlay));

socket.on("player-list", (players) => {
  state.players = players;
  const isClickable = state.phase === "night"
    ? (state.myRole === "killer" || state.myRole === "medic") && !state.hasActed
    : state.phase === "voting" && !state.hasVoted;
  renderPlayerGrid(isClickable);
});

socket.on("phase-change", ({ phase, timeLeft, players }) => {
  state.phase = phase;
  state.hasActed = false;
  state.hasVoted = false;
  state.selectedTarget = null;

  const maxes = { day: 60, night: 30, voting: 40 };
  setPhaseUI(phase, timeLeft, maxes[phase] || timeLeft);
  setActionArea(phase, state.myRole);

  if (players) {
    state.players = players;
  }

  const clickable = (phase === "night" && (state.myRole === "killer" || state.myRole === "medic"))
                 || (phase === "voting");
  renderPlayerGrid(clickable);
});

socket.on("timer-tick", (t) => {
  updateTimer(t, state.timerMax);
});

socket.on("action-confirmed", ({ action, targetName }) => {
  state.hasActed = true;
  actionPrompt.textContent = action === "kill"
    ? `🔪 Target locked: ${targetName}`
    : `💊 Protecting: ${targetName}`;
  renderPlayerGrid(false);
});

socket.on("night-result", ({ saved, killedId, killedName, killedRole }) => {
  if (saved) {
    flashResult("💊 The medic saved someone tonight! No one died.", "var(--teal)");
  } else if (killedName) {
    flashResult(`☠️ <strong>${escHtml(killedName)}</strong> was killed last night${killedRole ? ` (was the ${killedRole})` : ""}.`, "var(--red-light)");
  } else {
    flashResult("The night passed quietly…", "var(--text-dim)");
  }
 
  if (killedId) {
    state.players = state.players.map(p => p.id === killedId ? { ...p, alive: false } : p);
    renderPlayerGrid(false);
  }
});

socket.on("vote-update", (tally) => {
  
  document.querySelectorAll(".vote-badge").forEach(b => b.remove());
  tally.forEach(({ targetId, count }) => {
    const card = document.querySelector(`.player-card[data-id="${targetId}"]`);
    if (card) {
      const badge = document.createElement("div");
      badge.className = "vote-badge";
      badge.textContent = count;
      card.appendChild(badge);
    }
  });
});

socket.on("vote-result", ({ eliminatedId, eliminatedName, eliminatedRole, voteCount }) => {
  if (eliminatedName) {
    flashResult(
      `⚖️ The town voted out <strong>${escHtml(eliminatedName)}</strong>${eliminatedRole ? ` — they were the <em>${eliminatedRole}</em>` : ""}. (${voteCount} vote${voteCount !== 1 ? "s" : ""})`,
      eliminatedRole === "killer" ? "var(--teal)" : "var(--red-light)"
    );
    if (eliminatedId) {
      state.players = state.players.map(p => p.id === eliminatedId ? { ...p, alive: false } : p);
      renderPlayerGrid(false);
    }
  } else {
    flashResult("⚖️ No consensus — the town could not decide.", "var(--text-muted)");
  }
});


socket.on("game-over", ({ winner, players }) => {
  state.players = players;
  renderPlayerGrid(false);

  const isWin = (winner === "civilians" && state.myRole !== "killer")
             || (winner === "killer" && state.myRole === "killer");

  gameoverLabel.textContent = isWin ? "🎉 Victory" : "💀 Defeat";
  gameoverTitle.textContent = winner === "civilians" ? "Civilians Win!" : "Killer Wins!";
  gameoverTitle.style.color = winner === "civilians" ? "var(--teal)" : "var(--red-light)";

  gameoverPlayers.innerHTML = "";
  players.forEach(p => {
    const chip = document.createElement("div");
    chip.className = "gameover-player-chip";
    chip.style.borderColor = p.color || "#333";

    const roleIcons = { killer: "🔪", medic: "💊", civilian: "👤" };
    chip.innerHTML = `<span>${roleIcons[p.role] || "?"}</span> <span style="color:${p.color}">${escHtml(p.name)}</span> <span style="opacity:.5">${p.role}</span> ${!p.alive ? "☠️" : ""}`;
    gameoverPlayers.appendChild(chip);
  });

  showOverlay(gameoverOverlay);
});

$("btn-back-lobby").addEventListener("click", () => {
  window.location.reload();
});


const actionPanel = $("action-panel");
