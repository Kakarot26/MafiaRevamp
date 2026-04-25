# 🎭 MAFIA — The Game

A real-time multiplayer Mafia game built with Socket.IO.

## Setup

### 1. Start the backend
```bash
cd server
npm install
npm start
# Server runs on port 3000
```

### 2. Serve the frontend
Open `client/index.html` with any static server. Easiest options:

```bash
# Option A: VS Code Live Server extension (just open index.html)

# Option B: npx serve
cd client
npx serve . -p 5500
# Then open http://localhost:5500
```

## How to Play

| Role       | Count | Night Action |
|------------|-------|--------------|
| 🔪 Killer  | 1     | Pick anyone (except yourself) to eliminate |
| 💊 Medic   | 1     | Pick anyone to protect (can protect themselves) |
| 👤 Civilian | Rest | No night action — discuss and vote |

### Game Loop
1. **Lobby** — Host creates room, others join with the code. Host clicks Start.
2. **Countdown** — 10 seconds before roles are revealed.
3. **Day (60s)** — Discuss freely in chat.
4. **Night (30s)** — Killer picks a target. Medic picks someone to protect. If they match → target survives.
5. **Voting (40s)** — Everyone votes on who they think the Killer is. Most votes = eliminated.
6. Repeat until Civilians eliminate the Killer (Civilians win) or Killer equals/outnumbers remaining players (Killer wins).

## Architecture

```
mafia-game/
├── server/
│   └── server.js      # Socket.IO server — all game logic
└── client/
    ├── index.html     # Single page app
    ├── app.js         # All client-side socket & UI logic
    └── styles/
        └── style.css  # Dark noir theme
```

## Key Design Decisions
- **Rooms** are plain Map entries on the server; no DB needed for a session game.
- **Roles** are never broadcast to other clients — only sent privately via `socket.to(id).emit`.
- **Votes** use a `Map<targetId, Set<voterId>>` so each player can change their vote.
- **Host transfer** happens automatically if the host disconnects.

## Features to be implemented
- **Leaderboard**
- **Profile Customization**
- **More Roles**
