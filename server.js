const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "banditimo-db.json");
const ENERGY_INTERVAL_MS = 60 * 1000;

app.use(express.json());
app.use(express.static(__dirname));

function defaultDb() {
  return {
    casinoBalance: 5000,
    players: {},
    logs: ["Server ready. Welcome to Banditimo v0.0.7."]
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const db = defaultDb();
    saveDb(db);
    return db;
  }

  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    db.casinoBalance ??= 5000;
    db.players ??= {};
    db.logs ??= [];
    return db;
  } catch {
    const db = defaultDb();
    saveDb(db);
    return db;
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function cleanName(username) {
  return String(username || "").trim();
}

function validUsername(username) {
  const u = cleanName(username);
  if (!u) return false;
  if (u.toLowerCase() === "player") return false;
  if (u.length > 20) return false;
  return /^[a-zA-Z0-9_ -]+$/.test(u);
}

function createPlayer(username) {
  return {
    username,
    cash: 0,
    xp: 0,
    energy: 10,
    maxEnergy: 10,
    inventory: Array(10).fill(null),
    blackjack: null,
    lastEnergyTick: Date.now(),
    lastSeen: Date.now()
  };
}

const itemData = {
  bicycle: { name: "Bicycle", sellPrice: 20, power: 0 },
  knife: { name: "Knife", sellPrice: 50, power: 5, shopPrice: 100 },
  gun: { name: "Gun", sellPrice: 500, power: 25, shopPrice: 1000 },
  corolla: { name: "Toyota Corolla", sellPrice: 500, power: 0 },
  audi_s3: { name: "Audi S3", sellPrice: 3000, power: 0 }
};

function getRank(xp) {
  if (xp >= 500) return "Street Thief";
  if (xp >= 100) return "Hustler";
  return "Rookie";
}

function power(player) {
  return player.inventory.reduce((sum, item) => sum + (item ? itemData[item.type]?.power || 0 : 0), 0);
}

function updateEnergy(player) {
  player.lastEnergyTick ??= Date.now();
  player.energy ??= 10;
  player.maxEnergy ??= 10;

  if (player.energy >= player.maxEnergy) {
    player.lastEnergyTick = Date.now();
    return;
  }

  const gained = Math.floor((Date.now() - player.lastEnergyTick) / ENERGY_INTERVAL_MS);
  if (gained > 0) {
    player.energy = Math.min(player.maxEnergy, player.energy + gained);
    player.lastEnergyTick += gained * ENERGY_INTERVAL_MS;
    if (player.energy >= player.maxEnergy) player.lastEnergyTick = Date.now();
  }
}

function energyTimer(player) {
  updateEnergy(player);
  if (player.energy >= player.maxEnergy) return "Full";
  const left = Math.ceil((ENERGY_INTERVAL_MS - (Date.now() - player.lastEnergyTick)) / 1000);
  return `${Math.max(0, left)}s`;
}

function hydratePlayer(player) {
  player.cash ??= 0;
  player.xp ??= 0;
  player.energy ??= 10;
  player.maxEnergy ??= 10;
  player.inventory = Array.isArray(player.inventory) ? player.inventory.slice(0, 10) : Array(10).fill(null);
  while (player.inventory.length < 10) player.inventory.push(null);
  player.lastEnergyTick ??= Date.now();
  updateEnergy(player);
  player.lastSeen = Date.now();
  return player;
}

function publicPlayer(player) {
  updateEnergy(player);
  return {
    username: player.username,
    cash: player.cash,
    xp: player.xp,
    rank: getRank(player.xp),
    energy: player.energy,
    maxEnergy: player.maxEnergy,
    energyTimer: energyTimer(player),
    inventory: player.inventory,
    power: power(player),
    blackjack: player.blackjack || null
  };
}

function addLog(db, message, type = "") {
  db.logs.unshift(type ? `<span class="${type}">${message}</span>` : message);
  db.logs = db.logs.slice(0, 50);
}

function getPlayer(db, username) {
  const u = cleanName(username);
  if (!db.players[u]) return null;
  return hydratePlayer(db.players[u]);
}

function response(db, player, extra = {}) {
  return {
    player: publicPlayer(player),
    casinoBalance: db.casinoBalance,
    logs: db.logs,
    ...extra
  };
}

function spendEnergy(player) {
  updateEnergy(player);
  if (player.energy < 1) return false;
  player.energy -= 1;
  return true;
}

function hasItem(player, type) {
  return player.inventory.some(item => item && item.type === type);
}

function addItem(player, type) {
  const slot = player.inventory.findIndex(x => x === null);
  if (slot === -1) return false;
  player.inventory[slot] = { type };
  return true;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: "0.0.7" });
});

app.post("/api/login", (req, res) => {
  const db = loadDb();
  const username = cleanName(req.body.username);

  if (!validUsername(username)) {
    return res.status(400).json({ error: "Username cannot be empty, cannot be 'player', max 20 chars, and only letters/numbers/spaces/_/-." });
  }

  if (!db.players[username]) {
    db.players[username] = createPlayer(username);
    addLog(db, `${username} entered the streets for the first time.`, "gold");
  }

  const player = hydratePlayer(db.players[username]);
  saveDb(db);
  res.json(response(db, player));
});

app.get("/api/state/:username", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.params.username);
  if (!player) return res.status(404).json({ error: "Player not found." });
  saveDb(db);
  res.json(response(db, player));
});

app.post("/api/action", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.body.username);
  if (!player) return res.status(404).json({ error: "Player not found." });

  const action = req.body.action;
  const payload = req.body.payload || {};
  let msg = "";
  let type = "";

  if (action === "stealBicycle") {
    if (!spendEnergy(player)) return res.status(400).json({ error: "Not enough energy." });
    if (chance(30)) {
      if (addItem(player, "bicycle")) {
        player.xp += 2;
        msg = `${player.username} stole a bicycle and gained 2 XP.`;
        type = "success";
      } else {
        msg = `${player.username} stole a bicycle, but inventory was full.`;
        type = "fail";
      }
    } else {
      msg = `${player.username} failed to steal a bicycle.`;
      type = "fail";
    }
  }

  if (action === "robGrandma") {
    if (!hasItem(player, "knife")) return res.status(400).json({ error: "You need a knife." });
    if (!spendEnergy(player)) return res.status(400).json({ error: "Not enough energy." });
    if (chance(50)) {
      player.cash += 100;
      player.xp += 5;
      msg = `${player.username} robbed a grandma and got $100 plus 5 XP.`;
      type = "success";
    } else {
      msg = `${player.username} failed to rob a grandma.`;
      type = "fail";
    }
  }

  if (action === "stealCar") {
    if (!hasItem(player, "gun")) return res.status(400).json({ error: "You need a gun." });
    if (!spendEnergy(player)) return res.status(400).json({ error: "Not enough energy." });
    if (chance(30)) {
      const car = chance(80) ? "corolla" : "audi_s3";
      if (addItem(player, car)) {
        player.xp += 20;
        msg = `${player.username} stole a ${itemData[car].name} and gained 20 XP.`;
        type = "success";
      } else {
        msg = `${player.username} stole a car, but inventory was full.`;
        type = "fail";
      }
    } else {
      msg = `${player.username} failed to steal a car.`;
      type = "fail";
    }
  }

  if (action === "buyItem") {
    const itemType = payload.itemType;
    const item = itemData[itemType];
    if (!item || !item.shopPrice) return res.status(400).json({ error: "Invalid shop item." });
    if (player.cash < item.shopPrice) return res.status(400).json({ error: `You need $${item.shopPrice}.` });
    if (player.inventory.findIndex(x => x === null) === -1) return res.status(400).json({ error: "Inventory is full." });
    player.cash -= item.shopPrice;
    addItem(player, itemType);
    msg = `${player.username} bought a ${item.name} for $${item.shopPrice}.`;
    type = "gold";
  }

  if (action === "sellItem") {
    const slot = Number(payload.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) return res.status(400).json({ error: "Invalid slot." });
    const invItem = player.inventory[slot];
    if (!invItem) return res.status(400).json({ error: "No item in that slot." });
    const item = itemData[invItem.type];
    player.cash += item.sellPrice;
    player.inventory[slot] = null;
    msg = `${player.username} sold a ${item.name} for $${item.sellPrice}.`;
    type = "success";
  }

  if (!msg) return res.status(400).json({ error: "Unknown action." });

  addLog(db, msg, type);
  saveDb(db);
  res.json(response(db, player));
});

function checkBet(db, player, rawBet) {
  const bet = Math.floor(Number(rawBet));
  if (!Number.isFinite(bet) || bet < 1) return { error: "Minimum casino bet is $1." };
  if (bet > 1000) return { error: "Maximum casino bet is $1000." };
  if (player.cash < bet) return { error: "You do not have enough cash." };
  if (db.casinoBalance <= 0) return { error: "The casino is empty." };
  return { bet };
}

app.post("/api/casino/roulette", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.body.username);
  if (!player) return res.status(404).json({ error: "Player not found." });

  const checked = checkBet(db, player, req.body.bet);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const bet = checked.bet;

  const choice = String(req.body.choice);
  const redNumbers = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const rolled = Math.floor(Math.random() * 37);
  const color = rolled === 0 ? "green" : redNumbers.has(rolled) ? "red" : "black";

  let won = false;
  let multiplier = 0;

  if (choice === "red" || choice === "black") {
    won = choice === color;
    multiplier = 2;
  } else {
    const num = Number(choice);
    if (!Number.isInteger(num) || num < 0 || num > 36) return res.status(400).json({ error: "Invalid roulette choice." });
    won = num === rolled;
    multiplier = 30;
  }

  const payout = bet * multiplier;
  if (won && db.casinoBalance < payout) return res.status(400).json({ error: `Casino cannot cover the $${payout} payout.` });

  player.cash -= bet;
  db.casinoBalance += bet;

  let outcome = `${player.username} spun roulette: ${rolled} (${color}). `;

  if (won) {
    player.cash += payout;
    db.casinoBalance -= payout;
    outcome += `Won $${payout} on ${choice}.`;
    addLog(db, outcome, "success");
  } else {
    outcome += `Lost $${bet}.`;
    addLog(db, outcome, "fail");
  }

  saveDb(db);
  res.json(response(db, player, { outcome }));
});

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function drawCard() {
  return {
    rank: ranks[Math.floor(Math.random() * ranks.length)],
    suit: suits[Math.floor(Math.random() * suits.length)]
  };
}

function cardValue(card) {
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  if (card.rank === "A") return 11;
  return Number(card.rank);
}

function handValue(hand) {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter(card => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function finishBlackjack(db, player) {
  const bj = player.blackjack;
  if (!bj) return;
  bj.active = false;

  while (handValue(bj.dealer) < 17 && handValue(bj.player) <= 21) bj.dealer.push(drawCard());

  const pv = handValue(bj.player);
  const dv = handValue(bj.dealer);

  if (pv > 21) {
    addLog(db, `${player.username} busted in blackjack with ${pv}.`, "fail");
    return;
  }

  if (dv > 21 || pv > dv) {
    const payout = bj.bet * 2;
    if (db.casinoBalance >= payout) {
      player.cash += payout;
      db.casinoBalance -= payout;
      addLog(db, `${player.username} won blackjack and got paid $${payout}.`, "success");
    } else {
      addLog(db, `${player.username} won blackjack, but casino could not pay.`, "fail");
    }
    return;
  }

  if (pv === dv) {
    if (db.casinoBalance >= bj.bet) {
      player.cash += bj.bet;
      db.casinoBalance -= bj.bet;
      addLog(db, `${player.username} pushed blackjack and got $${bj.bet} refunded.`, "gold");
    }
    return;
  }

  addLog(db, `${player.username} lost blackjack. Dealer ${dv} beat ${pv}.`, "fail");
}

app.post("/api/casino/blackjack/start", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.body.username);
  if (!player) return res.status(404).json({ error: "Player not found." });

  const checked = checkBet(db, player, req.body.bet);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const bet = checked.bet;

  if (db.casinoBalance < bet * 2) return res.status(400).json({ error: "Casino cannot cover that blackjack payout." });

  player.cash -= bet;
  db.casinoBalance += bet;

  player.blackjack = {
    bet,
    player: [drawCard(), drawCard()],
    dealer: [drawCard(), drawCard()],
    active: true
  };

  addLog(db, `${player.username} started blackjack with a $${bet} bet.`, "gold");
  if (handValue(player.blackjack.player) === 21) finishBlackjack(db, player);

  saveDb(db);
  res.json(response(db, player));
});

app.post("/api/casino/blackjack/move", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.body.username);
  if (!player) return res.status(404).json({ error: "Player not found." });
  if (!player.blackjack || !player.blackjack.active) return res.status(400).json({ error: "No active blackjack game." });

  if (req.body.move === "hit") {
    player.blackjack.player.push(drawCard());
    if (handValue(player.blackjack.player) >= 21) finishBlackjack(db, player);
  } else if (req.body.move === "stand") {
    finishBlackjack(db, player);
  } else {
    return res.status(400).json({ error: "Invalid blackjack move." });
  }

  saveDb(db);
  res.json(response(db, player));
});

app.post("/api/casino/blackjack/clear", (req, res) => {
  const db = loadDb();
  const player = getPlayer(db, req.body.username);
  if (!player) return res.status(404).json({ error: "Player not found." });
  player.blackjack = null;
  saveDb(db);
  res.json(response(db, player));
});

app.get("/api/leaderboard", (req, res) => {
  const db = loadDb();
  const sort = ["cash", "power", "xp"].includes(req.query.sort) ? req.query.sort : "xp";

  const players = Object.values(db.players).map(p => {
    hydratePlayer(p);
    return {
      username: p.username,
      cash: p.cash,
      energy: `${p.energy}/${p.maxEnergy}`,
      xp: p.xp,
      rank: getRank(p.xp),
      power: power(p),
      active: Date.now() - p.lastSeen < 5 * 60 * 1000
    };
  });

  players.sort((a, b) => b[sort] - a[sort]);
  saveDb(db);
  res.json({ players: players.slice(0, 10), sort });
});

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("Banditimo v0.0.7 server running.");
  console.log(`Local:  http://localhost:${PORT}`);
  getLanIps().forEach(ip => console.log(`LAN:    http://${ip}:${PORT}`));
});
