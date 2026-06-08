const itemData = {
  bicycle: { name: "Bicycle", emoji: "🚲", sellPrice: 20, power: 0, description: "A stolen bicycle. Easy cash." },
  knife: { name: "Knife", emoji: "🔪", sellPrice: 50, power: 5, description: "Needed to rob grandma." },
  gun: { name: "Gun", emoji: "🔫", sellPrice: 500, power: 25, description: "Needed to steal cars." },
  corolla: { name: "Toyota Corolla", emoji: "🚗", sellPrice: 500, power: 0, description: "Sells for $500." },
  audi_s3: { name: "Audi S3", emoji: "🏎️", sellPrice: 3000, power: 0, description: "Sells for $3000." }
};

let username = localStorage.getItem("banditimo_username") || "";
let state = null;
let selectedSlot = null;

function $(id) { return document.getElementById(id); }

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

async function login() {
  const input = $("usernameInput").value.trim();
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ username: input }) });
    username = data.player.username;
    localStorage.setItem("banditimo_username", username);
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("usernameLabel").textContent = username;
    applyState(data);
    await loadLeaderboard("xp");
  } catch (err) {
    $("loginError").textContent = err.message;
  }
}

function logout() {
  localStorage.removeItem("banditimo_username");
  location.reload();
}

function applyState(data) {
  state = data;
  render();
}

async function refreshState() {
  if (!username) return;
  try { applyState(await api(`/api/state/${encodeURIComponent(username)}`)); }
  catch (err) { console.warn(err.message); }
}

async function doAction(action) {
  try {
    applyState(await api("/api/action", { method: "POST", body: JSON.stringify({ username, action }) }));
    await loadLeaderboard();
  } catch (err) { addLocalError(err.message); }
}

async function buyItem(itemType) {
  try {
    applyState(await api("/api/action", {
      method: "POST",
      body: JSON.stringify({ username, action: "buyItem", payload: { itemType } })
    }));
    await loadLeaderboard();
  } catch (err) { addLocalError(err.message); }
}

async function sellSelectedItem() {
  if (selectedSlot === null) return addLocalError("No item selected.");
  try {
    applyState(await api("/api/action", {
      method: "POST",
      body: JSON.stringify({ username, action: "sellItem", payload: { slot: selectedSlot } })
    }));
    selectedSlot = null;
    await loadLeaderboard();
  } catch (err) { addLocalError(err.message); }
}

async function startBlackjack() {
  try {
    applyState(await api("/api/casino/blackjack/start", {
      method: "POST",
      body: JSON.stringify({ username, bet: $("blackjackBet").value })
    }));
  } catch (err) { addLocalError(err.message); }
}

async function blackjackMove(move) {
  try {
    applyState(await api("/api/casino/blackjack/move", {
      method: "POST",
      body: JSON.stringify({ username, move })
    }));
  } catch (err) { addLocalError(err.message); }
}

async function clearBlackjack() {
  try {
    applyState(await api("/api/casino/blackjack/clear", {
      method: "POST",
      body: JSON.stringify({ username })
    }));
  } catch (err) { addLocalError(err.message); }
}

async function playRoulette() {
  try {
    const data = await api("/api/casino/roulette", {
      method: "POST",
      body: JSON.stringify({ username, bet: $("rouletteBet").value, choice: $("rouletteChoice").value })
    });
    $("rouletteArea").textContent = data.outcome;
    applyState(data);
  } catch (err) { addLocalError(err.message); }
}

function addLocalError(message) {
  if (!state) return alert(message);
  state.logs.unshift(`<span class="fail">${message}</span>`);
  renderLog();
}

function selectSlot(index) {
  selectedSlot = index;
  renderInventory();
}

function render() {
  if (!state) return;
  const p = state.player;
  $("cash").textContent = `$${p.cash}`;
  $("energy").textContent = `${p.energy}/${p.maxEnergy}`;
  $("energyTimer").textContent = p.energyTimer;
  $("casinoBalance").textContent = `$${state.casinoBalance}`;
  $("power").textContent = p.power;
  $("rank").textContent = `${p.rank} · ${p.xp} XP`;
  renderInventory();
  renderBlackjack();
  renderLog();
}

function renderInventory() {
  if (!state) return;
  const grid = $("inventoryGrid");
  grid.innerHTML = "";
  state.player.inventory.forEach((item, index) => {
    const slot = document.createElement("button");
    slot.className = "slot" + (item ? " filled" : "") + (selectedSlot === index ? " selected" : "");
    slot.onclick = () => selectSlot(index);
    if (item) {
      const data = itemData[item.type];
      slot.innerHTML = `${data.emoji}<br>${data.name}`;
    } else {
      slot.textContent = `Empty Slot ${index + 1}`;
    }
    grid.appendChild(slot);
  });

  const selected = state.player.inventory[selectedSlot];
  if (selected) {
    const data = itemData[selected.type];
    $("selectedItemBox").innerHTML = `
      <h3>${data.emoji} ${data.name}</h3>
      <p>${data.description}</p>
      <p>Power: +${data.power} · Sell value: $${data.sellPrice}</p>
      <button onclick="sellSelectedItem()">Sell for $${data.sellPrice}</button>
    `;
  } else {
    $("selectedItemBox").innerHTML = `<h3>No item selected</h3><p>Select an item slot first.</p>`;
  }
}

function cardValue(card) {
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  if (card.rank === "A") return 11;
  return Number(card.rank);
}

function handValue(hand) {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter(card => card.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function handText(hand) { return hand.map(c => `${c.rank}${c.suit}`).join(" "); }

function renderBlackjack() {
  const bj = state?.player?.blackjack;
  if (!bj) {
    $("blackjackArea").innerHTML = "Place a bet and deal.";
    return;
  }
  const pv = handValue(bj.player);
  const dv = handValue(bj.dealer);
  if (bj.active) {
    $("blackjackArea").innerHTML = `
      <div>Bet: <span class="gold">$${bj.bet}</span></div>
      <div>Your hand: ${handText(bj.player)} = <b>${pv}</b></div>
      <div>Dealer shows: ${bj.dealer[0].rank}${bj.dealer[0].suit}</div>
      <div class="blackjack-buttons">
        <button onclick="blackjackMove('hit')">Hit</button>
        <button onclick="blackjackMove('stand')">Stand</button>
      </div>
    `;
  } else {
    $("blackjackArea").innerHTML = `
      <div>Bet: <span class="gold">$${bj.bet}</span></div>
      <div>Your hand: ${handText(bj.player)} = <b>${pv}</b></div>
      <div>Dealer hand: ${handText(bj.dealer)} = <b>${dv}</b></div>
      <button onclick="clearBlackjack()">Clear Table</button>
    `;
  }
}

function renderLog() {
  $("log").innerHTML = (state.logs || []).map(line => `<div class="log-line">${line}</div>`).join("");
}

function showCasinoGame(game) {
  document.querySelectorAll(".casino-game").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".casino-toggle").forEach(el => el.classList.remove("active"));
  $(`${game}Game`).classList.add("active");
  $(`${game}Toggle`).classList.add("active");
}

let currentLeaderboardSort = "xp";
async function loadLeaderboard(sort = currentLeaderboardSort) {
  currentLeaderboardSort = sort;
  try {
    const data = await api(`/api/leaderboard?sort=${sort}`);
    const rows = data.players.map((p, i) => `
      <div class="lb-row">
        <span>${i + 1}</span>
        <span>${p.active ? "🟢" : "⚫"} ${p.username}</span>
        <span>$${p.cash}</span>
        <span>${p.power}</span>
        <span>${p.xp}</span>
        <span>${p.rank}</span>
      </div>
    `).join("");
    $("leaderboardTable").innerHTML = `
      <div class="lb-row lb-head"><span>#</span><span>Player</span><span>Cash</span><span>Power</span><span>XP</span><span>Rank</span></div>
      ${rows || "<p>No players yet.</p>"}
    `;
  } catch (err) {
    $("leaderboardTable").textContent = err.message;
  }
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.page).classList.add("active");
    if (tab.dataset.page === "leaderboard") loadLeaderboard();
  });
});

function setupRouletteChoices() {
  const select = $("rouletteChoice");
  select.innerHTML = `<option value="red">Red</option><option value="black">Black</option>`;
  for (let i = 0; i <= 36; i++) select.innerHTML += `<option value="${i}">${i}</option>`;
}

setupRouletteChoices();

$("usernameInput").addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});

if (username) {
  $("usernameInput").value = username;
  login();
}

setInterval(refreshState, 5000);
setInterval(() => loadLeaderboard(), 10000);
