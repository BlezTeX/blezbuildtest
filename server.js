import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_PATH = path.join(DATA_DIR, 'save.json');
const PORT = 5173;

const defaultSave = () => ({ version: '0.1.2', players: {}, world: { ownedTiles: [] }, logs: [], updatedAt: Date.now() });
let save = defaultSave();
let saveTimer = null;

function loadSave() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SAVE_PATH)) save = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    if (!save.players) save.players = {};
    if (!save.world) save.world = { ownedTiles: [] };
    if (!Array.isArray(save.world.ownedTiles)) save.world.ownedTiles = [];
    if (!Array.isArray(save.logs)) save.logs = [];
  } catch (err) {
    console.error('Could not load save file, starting fresh:', err);
    save = defaultSave();
  }
}
function queueSave() {
  save.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(SAVE_PATH, JSON.stringify(save, null, 2)), 150);
}
function cleanName(name) {
  return String(name || '').trim().replace(/[^a-zA-Z0-9_\- ]/g, '').slice(0, 18) || 'Player';
}
function getDefaultPlayer(name) {
  return {
    name,
    bananaBalance: 1000,
    inventorySlots: Array.from({ length: 9 }, () => null),
    equippedTool: null,
    targetTile: { x: 25, z: 25 },
    position: { x: 25, z: 25 },
    lastWheelSpin: 0,
    onlineAt: Date.now(),
    updatedAt: Date.now()
  };
}
function publicPlayers(excludeName = '') {
  const now = Date.now();
  return Object.values(save.players)
    .filter(p => p && p.name !== excludeName && p.onlineAt && now - p.onlineAt < 10000)
    .map(p => ({ name: p.name, position: p.position || p.targetTile || { x: 25, z: 25 }, targetTile: p.targetTile || { x: 25, z: 25 } }));
}
function addLog(message) {
  save.logs.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, message: String(message || '').slice(0, 120), time: Date.now() });
  save.logs = save.logs.slice(-40);
  queueSave();
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return body ? JSON.parse(body) : {}; } catch { return {}; }
}
function sendFile(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(__dirname, urlPath));
  if (!filePath.startsWith(__dirname)) return void json(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return void json(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

loadSave();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/ping') return json(res, 200, { ok: true, version: '0.1.2' });
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const name = cleanName(url.searchParams.get('name'));
    if (save.players[name]) { save.players[name].onlineAt = Date.now(); queueSave(); }
    return json(res, 200, { world: save.world, onlinePlayers: publicPlayers(name), logs: save.logs.slice(-12) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (!save.players[name]) save.players[name] = getDefaultPlayer(name);
    save.players[name].name = name;
    save.players[name].onlineAt = Date.now();
    save.players[name].updatedAt = Date.now();
    queueSave();
    return json(res, 200, { player: save.players[name], world: save.world, onlinePlayers: publicPlayers(name), logs: save.logs.slice(-12) });
  }
  if (req.method === 'POST' && url.pathname === '/api/save-player') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    const current = save.players[name] || getDefaultPlayer(name);
    const data = body.player || {};
    save.players[name] = {
      ...current,
      name,
      bananaBalance: Number.isFinite(data.bananaBalance) ? data.bananaBalance : current.bananaBalance,
      inventorySlots: Array.isArray(data.inventorySlots) ? data.inventorySlots.slice(0, 9) : current.inventorySlots,
      equippedTool: data.equippedTool || null,
      targetTile: data.targetTile || current.targetTile,
      position: data.position || current.position,
      lastWheelSpin: Number.isFinite(data.lastWheelSpin) ? data.lastWheelSpin : current.lastWheelSpin,
      onlineAt: Date.now(),
      updatedAt: Date.now()
    };
    queueSave();
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/save-world') {
    const body = await readBody(req);
    if (Array.isArray(body.ownedTiles)) save.world.ownedTiles = body.ownedTiles;
    queueSave();
    return json(res, 200, { ok: true, world: save.world });
  }
  if (req.method === 'POST' && url.pathname === '/api/log') {
    const body = await readBody(req);
    addLog(body.message);
    return json(res, 200, { ok: true });
  }
  return sendFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('Banana Empire 0.1.2 LAN server running:');
  console.log(`  This PC: http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  LAN:     http://${ip}:${PORT}`);
  console.log('');
  console.log('This version has no npm install step. Keep this window open while playtesting.');
});
