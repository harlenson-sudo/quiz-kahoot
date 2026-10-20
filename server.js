// Quiz ao vivo estilo Kahoot — servidor (Node.js + Express + Socket.IO)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || 'professor123';          // senha do painel do professor
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const RANKING_SIZE = 10;                                          // quantos aparecem no telão

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ---------------- Estado do jogo ----------------
// phase: lobby -> question -> results -> (question ...) -> final
const game = {
  phase: 'lobby',
  index: -1,
  startedAt: 0,
  timer: null,
  answers: new Map(),   // playerId -> { choice, points }
  players: new Map(),   // playerId -> { id, name, score, socketId, connected, lastPoints }
};

const current = () => questions[game.index];

function ranking() {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p, i) => ({ id: p.id, name: p.name, score: p.score, rank: i + 1, lastPoints: p.lastPoints }));
}

function playerSummary() {
  const list = [...game.players.values()];
  return { total: list.length, online: list.filter(p => p.connected).length, names: list.map(p => p.name) };
}

// Atualizações da sala de espera são agrupadas (evita 150 emissões seguidas quando todos entram juntos)
let lobbyPending = false;
function notifyHostPlayers() {
  if (lobbyPending) return;
  lobbyPending = true;
  setTimeout(() => { lobbyPending = false; io.to('host').emit('players', playerSummary()); }, 300);
}

function uniqueName(raw) {
  const base = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Aluno';
  const taken = new Set([...game.players.values()].map(p => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function questionPayload() {
  const q = current();
  const elapsed = Date.now() - game.startedAt;
  return {
    index: game.index,
    total: questions.length,
    text: q.pergunta,
    options: q.opcoes,
    time: q.tempo,
    timeLeft: Math.max(0, q.tempo * 1000 - elapsed),
  };
}

function startQuestion() {
  game.index++;
  if (game.index >= questions.length) return finish();
  game.phase = 'question';
  game.answers = new Map();
  game.startedAt = Date.now();
  for (const p of game.players.values()) p.lastPoints = 0;
  io.emit('question', questionPayload());
  io.to('host').emit('answerCount', { count: 0, total: playerSummary().online });
  clearTimeout(game.timer);
  game.timer = setTimeout(endQuestion, current().tempo * 1000 + 500); // +0,5 s de tolerância de rede
}

function endQuestion() {
  if (game.phase !== 'question') return;
  clearTimeout(game.timer);
  game.phase = 'results';
  const q = current();
  const distribution = q.opcoes.map(() => 0);
  for (const a of game.answers.values()) distribution[a.choice]++;
  const rank = ranking();

  io.to('host').emit('results', {
    index: game.index,
    total: questions.length,
    correct: q.correta,
    options: q.opcoes,
    text: q.pergunta,
    distribution,
    answered: game.answers.size,
    top: rank.slice(0, RANKING_SIZE),
    isLast: game.index === questions.length - 1,
  });

  // Cada aluno recebe o próprio resultado e posição
  for (const r of rank) {
    const p = game.players.get(r.id);
    if (!p.connected) continue;
    const a = game.answers.get(p.id);
    io.to(p.socketId).emit('myResult', {
      answered: !!a,
      correct: !!a && a.choice === q.correta,
      points: a ? a.points : 0,
      score: p.score,
      rank: r.rank,
      totalPlayers: rank.length,
      correctText: q.opcoes[q.correta],
    });
  }
}

function finish() {
  clearTimeout(game.timer);
  game.phase = 'final';
  const rank = ranking();
  io.to('host').emit('final', { top: rank.slice(0, RANKING_SIZE), totalPlayers: rank.length });
  for (const r of rank) {
    const p = game.players.get(r.id);
    if (p.connected) io.to(p.socketId).emit('final', { rank: r.rank, score: r.score, totalPlayers: rank.length });
  }
}

function resetGame() {
  clearTimeout(game.timer);
  game.phase = 'lobby';
  game.index = -1;
  game.answers = new Map();
  game.players.clear();
  io.emit('reset');
  notifyHostPlayers();
}

// ---------------- Conexões ----------------
io.on('connection', socket => {
  // ----- Aluno -----
  socket.on('join', ({ id, name } = {}, ack = () => {}) => {
    let p = id && game.players.get(id);
    if (p) {                                     // reconexão (celular bloqueou a tela, trocou de rede...)
      p.socketId = socket.id;
      p.connected = true;
    } else {
      if (game.phase !== 'lobby' && game.phase !== 'question' && game.phase !== 'results') {
        return ack({ error: 'O quiz já terminou.' });
      }
      p = { id: crypto.randomUUID(), name: uniqueName(name), score: 0, socketId: socket.id, connected: true, lastPoints: 0 };
      game.players.set(p.id, p);
    }
    socket.data.playerId = p.id;
    ack({ id: p.id, name: p.name, score: p.score, phase: game.phase });
    if (game.phase === 'question' && !game.answers.has(p.id)) socket.emit('question', questionPayload());
    notifyHostPlayers();
  });

  socket.on('answer', (choice, ack = () => {}) => {
    const p = game.players.get(socket.data.playerId);
    if (!p || game.phase !== 'question' || game.answers.has(p.id)) return ack({ ok: false });
    const q = current();
    choice = Number(choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.opcoes.length) return ack({ ok: false });

    // Pontuação estilo Kahoot: até 1000 pontos, quanto mais rápido, mais pontos (mínimo 500 se acertar)
    const elapsed = Date.now() - game.startedAt;
    const limit = q.tempo * 1000;
    const points = choice === q.correta ? Math.round(1000 * (1 - Math.min(elapsed, limit) / limit / 2)) : 0;
    game.answers.set(p.id, { choice, points });
    p.score += points;
    p.lastPoints = points;
    ack({ ok: true });

    const online = playerSummary().online;
    io.to('host').emit('answerCount', { count: game.answers.size, total: online });
    if (game.answers.size >= online) endQuestion();   // todos responderam: encerra antes do tempo
  });

  // ----- Professor -----
  socket.on('host:auth', async (key, ack = () => {}) => {
    if (key !== HOST_KEY) return ack({ ok: false });
    socket.join('host');
    socket.data.isHost = true;
    const qr = await QRCode.toDataURL(PUBLIC_URL, { width: 480, margin: 1 });
    ack({ ok: true, qr, url: PUBLIC_URL, phase: game.phase, totalQuestions: questions.length, players: playerSummary() });
  });

  const hostOnly = fn => (...args) => socket.data.isHost && fn(...args);
  socket.on('host:next', hostOnly(() => { if (game.phase === 'lobby' || game.phase === 'results') startQuestion(); }));
  socket.on('host:skip', hostOnly(() => endQuestion()));
  socket.on('host:finish', hostOnly(() => finish()));
  socket.on('host:reset', hostOnly(() => resetGame()));

  socket.on('disconnect', () => {
    const p = game.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      notifyHostPlayers();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Quiz rodando na porta ${PORT}`);
  console.log(`Alunos:    ${PUBLIC_URL}`);
  console.log(`Professor: ${PUBLIC_URL}/host?key=${HOST_KEY}`);
});
