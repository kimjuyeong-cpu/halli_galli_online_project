const socket = io();
const $ = id => document.getElementById(id);
let myId = null, myCode = null, latest = null;

function show(section) {
  ["home","lobby","game"].forEach(id => $(id).classList.toggle("hidden", id !== section));
}
function nameValue() { return $("name").value.trim(); }
function setError(message) {
  const target = $("home").classList.contains("hidden") ?
    ($("lobby").classList.contains("hidden") ? $("message") : $("lobbyError")) : $("homeError");
  target.textContent = message || "";
}
$("create").onclick = () => socket.emit("createRoom", {name:nameValue()});
$("join").onclick = () => socket.emit("joinRoom", {name:nameValue(), code:$("roomCode").value});
$("start").onclick = () => socket.emit("startGame");
$("flip").onclick = () => socket.emit("flipCard");
$("bell").onclick = () => socket.emit("ringBell");
$("restart").onclick = () => socket.emit("restartGame");
$("copyCode").onclick = async () => {
  try { await navigator.clipboard.writeText(myCode); $("copyCode").textContent = "복사 완료"; }
  catch { $("copyCode").textContent = myCode; }
};
$("roomCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase());

socket.on("joined", data => {
  myCode = data.code; myId = data.playerId;
  $("roomCodeView").textContent = myCode;
  $("gameCode").textContent = myCode;
  show("lobby");
});
socket.on("errorMessage", msg => setError(msg));
socket.on("state", state => {
  latest = state;
  if (state.status === "lobby") renderLobby(state);
  else renderGame(state);
});
function renderLobby(s) {
  show("lobby");
  $("roomCodeView").textContent = s.code;
  $("playerCount").textContent = `${s.players.length}/4`;
  $("lobbyPlayers").innerHTML = s.players.map(p =>
    `<div class="player-item">${escapeHtml(p.name)} ${p.host ? "<b>방장</b>" : ""}</div>`
  ).join("");
  const isHost = s.players.some(p => p.id === myId && p.host);
  $("start").classList.toggle("hidden", !isHost);
  $("start").disabled = s.players.length < 2;
  $("lobbyHint").textContent = s.players.length < 2 ? "친구가 한 명 이상 더 들어오면 시작할 수 있어요." : "모두 모였어요! 방장이 게임을 시작할 수 있어요.";
  $("lobbyError").textContent = "";
}
function renderGame(s) {
  show("game");
  const totals = {"🍓":0,"🍋":0,"🍌":0,"🍇":0};
  s.activeCards.forEach(p => { if (p.card) totals[p.card.fruit] += p.card.amount; });
  $("totals").innerHTML = Object.entries(totals).map(([fruit,n]) =>
    `<div class="total-chip">${fruit}<b>${n}개</b></div>`).join("");
  $("tablePlayers").innerHTML = s.players.map(p => {
    const active = s.activeCards.find(a => a.id === p.id);
    const card = active && active.card;
    const isTurn = s.players[s.turnIndex] && s.players[s.turnIndex].id === p.id;
    const visual = card ? `<div class="playing-card">${Array(card.amount).fill(`<span class="fruit">${card.fruit}</span>`).join("")}</div>` : `<div class="playing-card empty-card">카드 대기</div>`;
    return `<div class="seat ${isTurn ? "current" : ""}"><div class="seat-name">${escapeHtml(p.name)} ${p.id === myId ? "(나)" : ""}</div><div class="seat-meta">남은 카드 ${p.count}장 · 획득 ${p.score}장 ${isTurn ? " · 현재 차례" : ""}</div>${visual}</div>`;
  }).join("");
  const myTurn = s.players[s.turnIndex] && s.players[s.turnIndex].id === myId;
  const me = s.players.find(p => p.id === myId);
  $("flip").disabled = s.status !== "playing" || !myTurn || !me || me.count === 0 || false;
  $("flip").textContent = myTurn ? "내 카드 뒤집기" : "다른 참가자 차례";
  $("bell").disabled = s.status !== "playing";
  $("message").textContent = s.bellMessage || (s.status === "finished" ? `게임 종료! 우승자: ${s.winner}` : "과일 합계가 정확히 5개라면 종을 누르세요.");
  $("restart").classList.toggle("hidden", s.status !== "finished" || !me || !me.host);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
