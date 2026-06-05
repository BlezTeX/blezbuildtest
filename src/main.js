import * as THREE from 'three';

const CHUNK_SIZE = 50;
const WORLD_COLS = CHUNK_SIZE * 2;
const WORLD_ROWS = CHUNK_SIZE;
const TILE_SIZE = 1;
const BUY_COST = 10;
const RECOLOR_COST = 5;
const DICE_MIN_BET = 10;
const DICE_MAX_BET = 100;
const WHEEL_COOLDOWN_MS = 60 * 60 * 1000;
const BLACKJACK_MIN_BET = 10;
const BLACKJACK_MAX_BET = 100;
const TOOL_COST = 200;
const RESOURCE_VALUE = 1;
const RESOURCE_YIELD = 5;
const RESOURCE_RESPAWN_MS = 60 * 1000;
const MAX_CHUNK0_TREES = 42;
const MAX_CHUNK0_ROCKS = 28;
const MOVE_SPEED = 4.8;
let playerName = localStorage.getItem('bananaEmpirePlayerName') || 'Player';
let bananaBalance = 1000;
let loggedIn = false;
let serverConnected = false;
let pollingTimer = null;
let saveQueued = false;
const remotePlayers = new Map();
const ownedTiles = new Map();
let selectedTile = null;
const ownedColors = [
  { name: 'Green Light', hex: 0x7be36d, css: '#7be36d' },
  { name: 'Green Mid', hex: 0x42bd56, css: '#42bd56' },
  { name: 'Green Deep', hex: 0x1f7a3a, css: '#1f7a3a' },
  { name: 'Blue Light', hex: 0x7fd8ff, css: '#7fd8ff' },
  { name: 'Blue Mid', hex: 0x2ea7e0, css: '#2ea7e0' },
  { name: 'Blue Deep', hex: 0x1456a3, css: '#1456a3' },
  { name: 'Yellow Light', hex: 0xfff08a, css: '#fff08a' },
  { name: 'Banana Yellow', hex: 0xffcf3f, css: '#ffcf3f' },
  { name: 'Gold Deep', hex: 0xc9901f, css: '#c9901f' },
  { name: 'Orange Light', hex: 0xffbd78, css: '#ffbd78' },
  { name: 'Orange Mid', hex: 0xff8c42, css: '#ff8c42' },
  { name: 'Orange Deep', hex: 0xb94d1e, css: '#b94d1e' },
  { name: 'Purple Light', hex: 0xd9b5ff, css: '#d9b5ff' },
  { name: 'Purple Mid', hex: 0xa06cff, css: '#a06cff' },
  { name: 'Purple Deep', hex: 0x5c2ca3, css: '#5c2ca3' },
  { name: 'Red Light', hex: 0xff9b9b, css: '#ff9b9b' },
  { name: 'Red Mid', hex: 0xe14c4c, css: '#e14c4c' },
  { name: 'Red Deep', hex: 0x8f2020, css: '#8f2020' },
  { name: 'White', hex: 0xf4f4ee, css: '#f4f4ee' },
  { name: 'Grey', hex: 0x8f9691, css: '#8f9691' },
  { name: 'Black', hex: 0x111513, css: '#111513' },
]
let selectedColor = ownedColors[0];

let targetTile = { x: 25, z: 25 };
let selectedMarker = null;
let cameraAngle = Math.PI / 4;
let cameraZoom = 13;
let cameraHeight = 24;
const cameraTarget = new THREE.Vector3(0, 0, 0);
const keys = new Set();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bd7e8);
scene.fog = new THREE.Fog(0x9bd7e8, 45, 95);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 220);

const sun = new THREE.DirectionalLight(0xfff3d0, 2.6);
sun.position.set(18, 35, 14);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xe8fff6, 0x3e6b3a, 1.15));

const world = new THREE.Group();
world.position.set(-WORLD_COLS / 2, 0, -WORLD_ROWS / 2);
scene.add(world);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tileMeshes = [];
const tileMap = new Map();
const blockedTiles = new Set();
const blockerObjects = [];
const casinoZones = new Map();
const shopZones = new Map();
const resources = new Map();
const inventorySlots = Array.from({ length: 9 }, () => null);
const STACK_LIMITS = { axe: 1, pickaxe: 1, wood: 50, stone: 50 };
let equippedTool = null;
let blackjackState = null;

function tileKey(x, z) { return `${x},${z}`; }
function addLog(message) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!eventLog) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `${time} · ${message}`;
  eventLog.prepend(line);
  while (eventLog.children.length > 8) eventLog.removeChild(eventLog.lastChild);
}
function getItemCount(type) {
  return inventorySlots.reduce((sum, slot) => sum + (slot?.type === type ? slot.amount : 0), 0);
}
function hasItem(type) { return getItemCount(type) > 0; }
function addItem(type, amount = 1) {
  let remaining = amount;
  const max = STACK_LIMITS[type] || 50;
  for (const slot of inventorySlots) {
    if (!slot || slot.type !== type || slot.amount >= max) continue;
    const add = Math.min(remaining, max - slot.amount);
    slot.amount += add;
    remaining -= add;
    if (remaining <= 0) return true;
  }
  for (let i = 0; i < inventorySlots.length; i++) {
    if (inventorySlots[i]) continue;
    const add = Math.min(remaining, max);
    inventorySlots[i] = { type, amount: add };
    remaining -= add;
    if (remaining <= 0) return true;
  }
  return false;
}
function removeAllItem(type) {
  let removed = 0;
  for (let i = 0; i < inventorySlots.length; i++) {
    const slot = inventorySlots[i];
    if (slot?.type === type) {
      removed += slot.amount;
      inventorySlots[i] = null;
    }
  }
  return removed;
}
function inWorld(x, z) { return x >= 0 && x < WORLD_COLS && z >= 0 && z < WORLD_ROWS; }
function getChunkId(x, z) { return x < CHUNK_SIZE ? 0 : 1; }
function isExpansionChunk(x, z) { return getChunkId(x, z) === 1; }
function worldX(x) { return x + 0.5 - WORLD_COLS / 2; }
function worldZ(z) { return z + 0.5 - WORLD_ROWS / 2; }
function blockTile(x, z) {
  if (inWorld(x, z)) blockedTiles.add(tileKey(x, z));
}
function isBlocked(x, z) { return blockedTiles.has(tileKey(x, z)); }
function isWalkableTile(x, z) { return inWorld(x, z) && !isBlocked(x, z); }
function canPlaceFootprint(x, z, w = 1, d = 1, margin = 0) {
  for (let zz = z - margin; zz < z + d + margin; zz++) {
    for (let xx = x - margin; xx < x + w + margin; xx++) {
      if (!inWorld(xx, zz)) return false;
      if (isBlocked(xx, zz) || isPath(xx, zz) || isPlaza(xx, zz) || casinoZones.has(tileKey(xx, zz)) || shopZones.has(tileKey(xx, zz))) return false;
    }
  }
  return true;
}
function blockFootprint(x, z, w = 1, d = 1) {
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) blockTile(xx, zz);
}
const status = document.getElementById('status');
const nameTag = document.getElementById('nameTag');
const dashName = document.getElementById('dashName');
const bananaAmount = document.getElementById('bananaAmount');
const ownedTilesAmount = document.getElementById('ownedTilesAmount');
const equippedToolAmount = document.getElementById('equippedToolAmount');
const inventoryGrid = document.getElementById('inventoryGrid');
const editNameBtn = document.getElementById('editNameBtn');
const tileDetails = document.getElementById('tileDetails');
const buyTileBtn = document.getElementById('buyTileBtn');
const colorTileBtn = document.getElementById('colorTileBtn');
const colorPicker = document.getElementById('colorPicker');
const colorLabel = document.getElementById('colorLabel');
const casinoPanel = document.getElementById('casinoPanel');
const diceGuess = document.getElementById('diceGuess');
const diceBet = document.getElementById('diceBet');
const rollDiceBtn = document.getElementById('rollDiceBtn');
const spinWheelBtn = document.getElementById('spinWheelBtn');
const casinoTitle = document.getElementById('casinoTitle');
const diceGame = document.getElementById('diceGame');
const wheelGame = document.getElementById('wheelGame');
const blackjackGame = document.getElementById('blackjackGame');
const blackjackBet = document.getElementById('blackjackBet');
const startBlackjackBtn = document.getElementById('startBlackjackBtn');
const hitBlackjackBtn = document.getElementById('hitBlackjackBtn');
const standBlackjackBtn = document.getElementById('standBlackjackBtn');
const blackjackCards = document.getElementById('blackjackCards');
const diceAnim = document.getElementById('diceAnim');
const wheelAnim = document.getElementById('wheelAnim');
const casinoResult = document.getElementById('casinoResult');
const eventLog = document.getElementById('eventLog');
const loginOverlay = document.getElementById('loginOverlay');
const loginNameInput = document.getElementById('loginNameInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

const materials = {
  grassA: new THREE.MeshLambertMaterial({ color: 0x55bd5f }),
  grassB: new THREE.MeshLambertMaterial({ color: 0x48ad54 }),
  grassC: new THREE.MeshLambertMaterial({ color: 0x63c76b }),
  path: new THREE.MeshLambertMaterial({ color: 0xb99867 }),
  stone: new THREE.MeshLambertMaterial({ color: 0xb9b9ae }),
  darkStone: new THREE.MeshLambertMaterial({ color: 0x7f8780 }),
  casinoFloorA: new THREE.MeshLambertMaterial({ color: 0x34313d }),
  casinoFloorB: new THREE.MeshLambertMaterial({ color: 0x40384b }),
  casinoTrim: new THREE.MeshLambertMaterial({ color: 0xffcc3f }),
  casinoZone: new THREE.MeshLambertMaterial({ color: 0xffdf4d }),
  casinoRed: new THREE.MeshLambertMaterial({ color: 0xb92e3c }),
  casinoBlue: new THREE.MeshLambertMaterial({ color: 0x275f9f }),
  shopFloor: new THREE.MeshLambertMaterial({ color: 0xb2d4a6 }),
  shopWall: new THREE.MeshLambertMaterial({ color: 0xf1d39b }),
  shopRoof: new THREE.MeshLambertMaterial({ color: 0x276455 }),
  tableGreen: new THREE.MeshLambertMaterial({ color: 0x1c7d50 }),
  emptyLand: new THREE.MeshLambertMaterial({ color: 0x777c78 }),
  emptyLandB: new THREE.MeshLambertMaterial({ color: 0x6d736f }),
  select: new THREE.MeshBasicMaterial({ color: 0xffdf4d, transparent: true, opacity: 0.62 }),
  bananaYellow: new THREE.MeshLambertMaterial({ color: 0xffcf3f }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x7a461f }),
  leaf1: new THREE.MeshLambertMaterial({ color: 0x1e8f3d }),
  leaf2: new THREE.MeshLambertMaterial({ color: 0x28a64a }),
  leaf3: new THREE.MeshLambertMaterial({ color: 0x3cba5c }),
  houseWall: new THREE.MeshLambertMaterial({ color: 0xffe1a8 }),
  houseWall2: new THREE.MeshLambertMaterial({ color: 0xd8f0df }),
  houseWall3: new THREE.MeshLambertMaterial({ color: 0xe9d2ff }),
  houseRoof: new THREE.MeshLambertMaterial({ color: 0x5b3a24 }),
  houseRoof2: new THREE.MeshLambertMaterial({ color: 0x1e5a45 }),
  houseRoof3: new THREE.MeshLambertMaterial({ color: 0xb45f33 }),
};

const tileGeo = new THREE.BoxGeometry(TILE_SIZE, 0.12, TILE_SIZE);
const insetGeo = new THREE.BoxGeometry(TILE_SIZE * 0.86, 0.025, TILE_SIZE * 0.86);

function isPath(x, z) {
  return x === 25 || z === 25 || (x > 5 && x < 18 && z === 37) || (z > 7 && z < 19 && x === 37) || (x > 31 && x < 45 && z === 14);
}

function isPlaza(x, z) {
  return x >= 21 && x <= 29 && z >= 21 && z <= 29;
}

function isCasinoTile(x, z) {
  return getChunkId(x, z) === 0 && x < 25 && z < 25 && !isPath(x, z) && !isPlaza(x, z);
}

for (let z = 0; z < WORLD_ROWS; z++) {
  for (let x = 0; x < WORLD_COLS; x++) {
    let mat;
    if (isExpansionChunk(x, z)) {
      mat = (x + z) % 2 === 0 ? materials.emptyLand : materials.emptyLandB;
    } else if (isCasinoTile(x, z)) mat = (x + z) % 2 === 0 ? materials.casinoFloorA : materials.casinoFloorB;
    else if (isPlaza(x, z)) mat = materials.stone;
    else if (isPath(x, z)) mat = materials.path;
    else mat = [materials.grassA, materials.grassB, materials.grassC][Math.abs((x * 17 + z * 11) % 3)];

    const tile = new THREE.Mesh(tileGeo, mat);
    tile.position.set(x + 0.5, -0.06, z + 0.5);
    tile.receiveShadow = true;
    tile.userData = { x, z, walkable: true, baseMaterial: mat, owner: null, colorIndex: 0 };
    world.add(tile);
    tileMeshes.push(tile);
    tileMap.set(tileKey(x, z), tile);

    const gridLine = new THREE.Mesh(insetGeo, new THREE.MeshBasicMaterial({ color: isExpansionChunk(x, z) ? 0x202621 : 0x0b3518, transparent: true, opacity: 0.07 }));
    gridLine.position.set(x + 0.5, 0.011, z + 0.5);
    world.add(gridLine);
  }
}

function addTree(x, z, scale = 1, force = false) {
  if (!force && !canPlaceFootprint(x, z, 1, 1, 0)) return false;
  blockFootprint(x, z, 1, 1);
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.68 * scale, 0.18 * scale), materials.trunk);
  trunk.position.y = 0.34 * scale;
  const leaves1 = new THREE.Mesh(new THREE.BoxGeometry(0.74 * scale, 0.42 * scale, 0.74 * scale), materials.leaf1);
  leaves1.position.y = 0.82 * scale;
  const leaves2 = new THREE.Mesh(new THREE.BoxGeometry(0.58 * scale, 0.36 * scale, 0.58 * scale), materials.leaf2);
  leaves2.position.y = 1.14 * scale;
  const leaves3 = new THREE.Mesh(new THREE.BoxGeometry(0.38 * scale, 0.28 * scale, 0.38 * scale), materials.leaf3);
  leaves3.position.y = 1.4 * scale;
  group.add(trunk, leaves1, leaves2, leaves3);
  group.position.set(x + 0.5, 0.02, z + 0.5);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  return group;
}

function addBananaTree(x, z) {
  if (!addTree(x, z, 1.08)) return false;
  const bananas = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), materials.bananaYellow);
    b.position.set((i - 1) * 0.11, 1.02, -0.31);
    bananas.add(b);
  }
  bananas.position.set(x + 0.5, 0.02, z + 0.5);
  world.add(bananas);
  return true;
}

function addHouse(x, z, size = 'small', variant = 0) {
  const dims = {
    small: { w: 2, d: 2, h: 1.05 },
    medium: { w: 2, d: 3, h: 1.15 },
    large: { w: 3, d: 6, h: 1.35 },
  }[size] || { w: 2, d: 2, h: 1.05 };
  if (!canPlaceFootprint(x, z, dims.w, dims.d, 0)) return false;
  blockFootprint(x, z, dims.w, dims.d);
  const group = new THREE.Group();

  const wallMats = [materials.houseWall, materials.houseWall2, materials.houseWall3];
  const roofMats = [materials.houseRoof, materials.houseRoof2, materials.houseRoof3];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w * 0.78, dims.h, dims.d * 0.72),
    wallMats[variant % wallMats.length]
  );
  body.position.y = dims.h / 2;

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w * 0.94, 0.34, dims.d * 0.88),
    roofMats[variant % roofMats.length]
  );
  roof.position.y = dims.h + 0.22;

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.54, 0.045), new THREE.MeshLambertMaterial({ color: 0x4a2a18 }));
  door.position.set(0, 0.3, -dims.d * 0.36 - 0.025);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.14, 0.045), materials.bananaYellow);
  sign.position.set(0, Math.min(dims.h - 0.12, 0.95), -dims.d * 0.36 - 0.03);

  for (let i = -1; i <= 1; i += 2) {
    if (dims.w > 2.2 || size !== 'small') {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.05), new THREE.MeshLambertMaterial({ color: 0x9bd7e8 }));
      window.position.set(i * dims.w * 0.22, 0.72, -dims.d * 0.36 - 0.035);
      group.add(window);
    }
  }

  group.add(body, roof, door, sign);
  group.position.set(x + dims.w / 2, 0.02, z + dims.d / 2);
  group.userData = { footprint: `${dims.w}x${dims.d}` };
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  return true;
}

function addRock(x, z) {
  if (!canPlaceFootprint(x, z, 1, 1, 0)) return false;
  blockFootprint(x, z, 1, 1);
  const rock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.34), materials.darkStone);
  rock.position.set(x + 0.5, 0.12, z + 0.5);
  rock.rotation.y = Math.random() * Math.PI;
  rock.castShadow = true;
  world.add(rock);
  blockerObjects.push(rock);
  return rock;
}



function unblockTile(x, z) { blockedTiles.delete(tileKey(x, z)); }

function isBrownEdgeTile(x, z) {
  return x === CHUNK_SIZE || x === WORLD_COLS - 1 || z === 0 || z === WORLD_ROWS - 1;
}

function addHarvestable(type, x, z) {
  // Resources currently belong only to the starter chunk, never to the casino district or the grey expansion chunk.
  if (getChunkId(x, z) !== 0 || isCasinoTile(x, z) || isBrownEdgeTile(x, z) || isPath(x, z) || isPlaza(x, z)) return false;
  if (!canPlaceFootprint(x, z, 1, 1, 0)) return false;
  const obj = type === 'tree' ? addTree(x, z, 0.85 + Math.random() * 0.25, true) : addRock(x, z);
  if (!obj) return false;
  const key = tileKey(x, z);
  resources.set(key, { type, object: obj, x, z });
  return true;
}

function spawnRandomResource(type) {
  const maxTries = 700;
  for (let i = 0; i < maxTries; i++) {
    const x = 2 + Math.floor(Math.random() * (CHUNK_SIZE - 4));
    const z = 2 + Math.floor(Math.random() * (CHUNK_SIZE - 4));
    if (addHarvestable(type, x, z)) return true;
  }
  return false;
}

function spawnChunk0Resources() {
  for (let i = 0; i < MAX_CHUNK0_TREES; i++) spawnRandomResource('tree');
  for (let i = 0; i < MAX_CHUNK0_ROCKS; i++) spawnRandomResource('rock');
}

function removeResource(key) {
  const res = resources.get(key);
  if (!res) return;
  world.remove(res.object);
  unblockTile(res.x, res.z);
  resources.delete(key);
  setTimeout(() => spawnRandomResource(res.type), RESOURCE_RESPAWN_MS);
}

function addShopBuilding(x, z) {
  if (!canPlaceFootprint(x, z, 4, 3, 0)) return false;
  blockFootprint(x, z, 4, 3);
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.25, 2.25), materials.shopWall);
  body.position.y = 0.66;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.34, 2.65), materials.shopRoof);
  roof.position.y = 1.45;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.28, 0.08), materials.bananaYellow);
  sign.position.set(0, 1.18, -1.18);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.72, 0.08), new THREE.MeshLambertMaterial({ color: 0x5b3a24 }));
  door.position.set(0, 0.39, -1.16);
  group.add(body, roof, sign, door);
  group.position.set(x + 2, 0.02, z + 1.5);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  addShopAccessZone(x, z, 4, 3);
  return true;
}

function addShopAccessZone(x, z, w, d) {
  for (let zz = z - 1; zz <= z + d; zz++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      if (!inWorld(xx, zz) || getChunkId(xx, zz) !== 0) continue;
      const insideObject = xx >= x && xx < x + w && zz >= z && zz < z + d;
      if (insideObject || isBlocked(xx, zz)) continue;
      const key = tileKey(xx, zz);
      shopZones.set(key, { label: 'Tool Shop' });
      setTileMaterial(xx, zz, materials.casinoZone);
    }
  }
}

function setTileMaterial(x, z, mat) {
  const tile = tileMap.get(tileKey(x, z));
  if (!tile) return;
  tile.material = mat;
  tile.userData.baseMaterial = mat;
}

function addCasinoAccessZone(x, z, w, d, gameId, label) {
  for (let zz = z - 1; zz <= z + d; zz++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      if (!inWorld(xx, zz) || getChunkId(xx, zz) !== 0) continue;
      const insideObject = xx >= x && xx < x + w && zz >= z && zz < z + d;
      if (insideObject || isBlocked(xx, zz)) continue;
      const key = tileKey(xx, zz);
      casinoZones.set(key, { gameId, label });
      setTileMaterial(xx, zz, materials.casinoZone);
    }
  }
}


function addCasinoDiceTable(x, z) {
  if (!canPlaceFootprint(x, z, 3, 2, 0)) return false;
  blockFootprint(x, z, 3, 2);
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.22, 1.45), materials.tableGreen);
  base.position.y = 0.28;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.16, 1.65), materials.casinoTrim);
  rail.position.y = 0.43;
  const felt = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.05, 1.18), materials.tableGreen);
  felt.position.y = 0.54;
  for (let i = 0; i < 2; i++) {
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshLambertMaterial({ color: 0xf4f4ee }));
    die.position.set(-0.35 + i * 0.7, 0.74, 0);
    die.rotation.set(0.4, 0.2 + i, 0.25);
    group.add(die);
  }
  group.add(base, rail, felt);
  group.position.set(x + 1.5, 0.02, z + 1);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  addCasinoAccessZone(x, z, 3, 2, 'dice', 'Dice Table');
  return true;
}

function addLuckyWheel(x, z) {
  if (!canPlaceFootprint(x, z, 2, 2, 0)) return false;
  blockFootprint(x, z, 2, 2);
  const group = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 0.18), materials.casinoTrim);
  stand.position.y = 0.58;
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 32), materials.casinoRed);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = 1.32;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 24), materials.casinoTrim);
  hub.rotation.x = Math.PI / 2;
  hub.position.y = 1.32;
  const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 3), materials.bananaYellow);
  pointer.position.set(0, 2.12, 0);
  pointer.rotation.z = Math.PI;
  group.add(stand, wheel, hub, pointer);
  group.position.set(x + 1, 0.02, z + 1);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  addCasinoAccessZone(x, z, 2, 2, 'wheel', 'Hourly Lucky Wheel');
  return true;
}


function addBlackjackTable(x, z) {
  if (!canPlaceFootprint(x, z, 3, 2, 0)) return false;
  blockFootprint(x, z, 3, 2);
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.22, 1.45), materials.casinoBlue);
  base.position.y = 0.28;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.16, 1.65), materials.casinoTrim);
  rail.position.y = 0.43;
  const felt = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 1.08), materials.casinoBlue);
  felt.position.y = 0.54;
  for (let i = 0; i < 3; i++) {
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.42), new THREE.MeshLambertMaterial({ color: 0xf4f4ee }));
    card.position.set(-0.45 + i * 0.45, 0.6, 0.02 + i * 0.04);
    card.rotation.y = 0.1 * i;
    group.add(card);
  }
  group.add(base, rail, felt);
  group.position.set(x + 1.5, 0.02, z + 1);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  addCasinoAccessZone(x, z, 3, 2, 'blackjack', 'Blackjack Table');
  return true;
}


function addCasinoSign(x, z) {
  if (!canPlaceFootprint(x, z, 2, 1, 0)) return false;
  blockFootprint(x, z, 2, 1);
  const group = new THREE.Group();
  const posts = [-0.55, 0.55].map((px) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), materials.casinoTrim);
    post.position.set(px, 0.6, 0);
    return post;
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 0.12), materials.casinoRed);
  board.position.y = 1.2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.16), materials.bananaYellow);
  top.position.y = 1.54;
  group.add(...posts, board, top);
  group.position.set(x + 1, 0.02, z + 0.5);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  world.add(group);
  blockerObjects.push(group);
  return true;
}

const housePlans = [
  [34,6,'small'], [38,6,'small'], [42,7,'medium'],
  [34,33,'small'], [38,33,'small'], [42,33,'small'], [35,38,'medium'],
  [10,39,'large'], [18,40,'medium'], [38,11,'small'], [42,11,'medium']
];
housePlans.forEach(([x,z,size], i) => addHouse(x, z, size, i));
addCasinoDiceTable(6, 9);
addLuckyWheel(14, 8);
addBlackjackTable(19, 14);
addCasinoSign(11, 4);
addShopBuilding(7, 31);
[[33,28],[34,28],[35,29],[10,29],[11,30],[31,35],[44,18]].forEach(([x,z]) => addBananaTree(x,z));
spawnChunk0Resources();

const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.32, 48), new THREE.MeshLambertMaterial({ color: 0x8e948c }));
fountainBase.position.set(worldX(25), 0.16, worldZ(25));
fountainBase.castShadow = true;
scene.add(fountainBase);
const water = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.08, 48), new THREE.MeshLambertMaterial({ color: 0x48b9f5, transparent: true, opacity: 0.74 }));
water.position.set(worldX(25), 0.38, worldZ(25));
scene.add(water);

const player = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.76, 0.32), new THREE.MeshLambertMaterial({ color: 0xffcf3f }));
body.position.y = 0.65;
const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.22, 0.34), new THREE.MeshLambertMaterial({ color: 0x2f4a36 }));
shirt.position.y = 0.86;
const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), new THREE.MeshLambertMaterial({ color: 0xffc58a }));
head.position.y = 1.23;
player.add(body, shirt, head);
player.position.set(worldX(targetTile.x), 0.08, worldZ(targetTile.z));
player.traverse((m) => { if (m.isMesh) m.castShadow = true; });
scene.add(player);

function setTarget(x, z) {
  selectedTile = { x, z };
  if (!isWalkableTile(x, z)) {
    status.textContent = `Tile ${x}, ${z} is blocked. Stand next to it if it is a resource.`;
    updateInteractionPanel();
    return false;
  }
  targetTile = { x, z };
  updateInteractionPanel();
  status.textContent = `Walking to tile ${x}, ${z}`;
  queueSavePlayer();
  if (selectedMarker) scene.remove(selectedMarker);
  selectedMarker = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.5, 36), materials.select);
  selectedMarker.rotation.x = -Math.PI / 2;
  selectedMarker.position.set(worldX(x), 0.052, worldZ(z));
  scene.add(selectedMarker);
  return true;
}

let pointerDown = false;
let pointerMoved = false;
let lastPointer = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = true;
  pointerMoved = false;
  lastPointer = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointerDown) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) pointerMoved = true;
  panCameraByPixels(dx, dy);
  lastPointer = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  pointerDown = false;
  if (pointerMoved) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(tileMeshes, false);
  if (hits.length) {
    const { x, z } = hits[0].object.userData;
    setTarget(x, z);
  }
});

window.addEventListener('wheel', (e) => {
  cameraZoom = THREE.MathUtils.clamp(cameraZoom + Math.sign(e.deltaY) * 0.9, 7, 28);
});

window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function panCameraByPixels(dx, dy) {
  const panScale = cameraZoom / 520;
  const forward = new THREE.Vector3(Math.cos(cameraAngle), 0, Math.sin(cameraAngle));
  const right = new THREE.Vector3(Math.cos(cameraAngle - Math.PI / 2), 0, Math.sin(cameraAngle - Math.PI / 2));
  cameraTarget.add(right.multiplyScalar(-dx * panScale));
  cameraTarget.add(forward.multiplyScalar(-dy * panScale));
  clampCameraTarget();
}

function clampCameraTarget() {
  cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, -WORLD_COLS / 2 - 4, WORLD_COLS / 2 + 4);
  cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, -WORLD_ROWS / 2 - 4, WORLD_ROWS / 2 + 4);
}

function updateKeyboardCamera(dt) {
  const panSpeed = cameraZoom * 1.2 * dt;
  const forward = new THREE.Vector3(Math.cos(cameraAngle), 0, Math.sin(cameraAngle));
  const right = new THREE.Vector3(Math.cos(cameraAngle - Math.PI / 2), 0, Math.sin(cameraAngle - Math.PI / 2));
  if (keys.has('w') || keys.has('arrowup')) cameraTarget.add(forward.multiplyScalar(-panSpeed));
  if (keys.has('s') || keys.has('arrowdown')) cameraTarget.add(forward.multiplyScalar(panSpeed));
  if (keys.has('d') || keys.has('arrowright')) cameraTarget.add(right.multiplyScalar(panSpeed));
  if (keys.has('a') || keys.has('arrowleft')) cameraTarget.add(right.multiplyScalar(-panSpeed));
  if (keys.has('q')) cameraAngle -= 1.4 * dt;
  if (keys.has('e')) cameraAngle += 1.4 * dt;
  clampCameraTarget();
}

function updateCamera() {
  const distance = 34;
  camera.position.set(
    cameraTarget.x + Math.cos(cameraAngle) * distance,
    cameraHeight,
    cameraTarget.z + Math.sin(cameraAngle) * distance
  );
  camera.lookAt(cameraTarget.x, 0, cameraTarget.z);
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -cameraZoom * aspect;
  camera.right = cameraZoom * aspect;
  camera.top = cameraZoom;
  camera.bottom = -cameraZoom;
  camera.updateProjectionMatrix();
}



function isPlayerOnSelectedTile() {
  if (!selectedTile) return false;
  const px = Math.floor(player.position.x + WORLD_COLS / 2);
  const pz = Math.floor(player.position.z + WORLD_ROWS / 2);
  return px === selectedTile.x && pz === selectedTile.z;
}

function updateTileVisual(x, z) {
  const tile = tileMap.get(tileKey(x, z));
  if (!tile) return;
  const owned = ownedTiles.get(tileKey(x, z));
  if (owned) tile.material = new THREE.MeshLambertMaterial({ color: owned.colorHex });
  else tile.material = tile.userData.baseMaterial;
}

function buildColorPicker() {
  colorPicker.innerHTML = ownedColors.map((color) => `
    <button class="color-choice ${color.css === selectedColor.css ? 'active' : ''}" data-color="${color.css}" style="--swatch:${color.css}" title="${color.name}"></button>
  `).join('');
}

function isPlayerAdjacentTo(x, z) {
  const px = Math.floor(player.position.x + WORLD_COLS / 2);
  const pz = Math.floor(player.position.z + WORLD_ROWS / 2);
  return Math.abs(px - x) + Math.abs(pz - z) === 1;
}

function isCurrentCasinoAllowed(gameId) {
  if (!selectedTile) return false;
  const zone = casinoZones.get(tileKey(selectedTile.x, selectedTile.z));
  return zone?.gameId === gameId && isPlayerOnSelectedTile();
}

function updateInteractionPanel() {
  if (!selectedTile) {
    tileDetails.innerHTML = '<p>Select a tile to inspect it.</p>';
    buyTileBtn.style.display = 'none';
    colorTileBtn.style.display = 'none';
    colorPicker.style.display = 'none';
    colorLabel.style.display = 'none';
    casinoPanel.style.display = 'none';
    buyTileBtn.disabled = true;
    colorTileBtn.disabled = true;
    return;
  }
  const { x, z } = selectedTile;
  const key = tileKey(x, z);
  const chunkId = getChunkId(x, z);
  const owned = ownedTiles.get(key);
  const blocked = isBlocked(x, z);
  const playerHere = isPlayerOnSelectedTile();
  const playerAdjacent = isPlayerAdjacentTo(x, z);
  const casinoTile = isCasinoTile(x, z);
  const casinoZone = casinoZones.get(key);
  const shopZone = shopZones.get(key);
  const resource = resources.get(key);
  const buyable = isExpansionChunk(x, z) && !owned && !blocked && playerHere;
  const ownedByPlayer = owned?.owner === playerName;
  const sameColor = owned?.color === selectedColor.css;
  const recolorable = ownedByPlayer && playerHere && !sameColor;
  let statusLabel = 'Starter';
  if (resource) statusLabel = resource.type === 'tree' ? 'Tree Resource' : 'Stone Resource';
  else if (blocked) statusLabel = casinoTile ? 'Casino Object' : 'Blocked';
  else if (shopZone) statusLabel = 'Tool Shop Zone';
  else if (casinoZone) statusLabel = casinoZone.label;
  else if (casinoTile) statusLabel = 'Casino District';
  else if (isExpansionChunk(x, z)) statusLabel = 'Expansion';

  let note = playerHere ? 'You are standing on this tile.' : 'Stand on the selected tile to interact.';
  if (resource) note = playerAdjacent ? `You are standing next to this ${resource.type}.` : `Stand next to this ${resource.type} to harvest it.`;
  if (shopZone) note = playerHere ? 'You are at the shop counter.' : 'Stand on this yellow shop zone to use the shop.';
  if (casinoZone) note = playerHere ? `You are at the ${casinoZone.label}.` : `Stand on this yellow ${casinoZone.label} zone to play.`;

  let extra = '';
  if (owned) extra += `<div class="tile-line"><span>Colour</span><strong>${owned.colorName}</strong></div>`;
  if (resource) extra += `<div class="tile-line"><span>Yield</span><strong>5 ${resource.type === 'tree' ? 'wood' : 'stone'}</strong></div>`;

  tileDetails.innerHTML = `
    <div class="tile-line"><span>Position</span><strong>${x}, ${z}</strong></div>
    <div class="tile-line"><span>Chunk</span><strong>${chunkId}</strong></div>
    <div class="tile-line"><span>Owner</span><strong>${owned ? owned.owner : 'Unowned'}</strong></div>
    <div class="tile-line"><span>Status</span><strong>${statusLabel}</strong></div>
    ${extra}
    <div class="tile-note">${note}</div>
  `;

  const shopHtml = shopZone && playerHere ? `
    <div class="tile-note"><strong>🛒 Tool Shop</strong><br>Buy tools or sell gathered resources.</div>
    <div class="action-row">
      <button type="button" class="action-btn" id="buyAxeBtn" data-shop-action="buy-axe" onclick="window.buyShopItem && window.buyShopItem('axe')">Buy Axe - 200 🍌</button>
      <button type="button" class="action-btn" id="buyPickaxeBtn" data-shop-action="buy-pickaxe" onclick="window.buyShopItem && window.buyShopItem('pickaxe')">Buy Pickaxe - 200 🍌</button>
    </div>
    <div class="action-row">
      <button type="button" class="action-btn" id="sellWoodBtn" data-shop-action="sell-wood">Sell Wood</button>
      <button type="button" class="action-btn" id="sellStoneBtn" data-shop-action="sell-stone">Sell Stone</button>
    </div>` : '';
  const harvestHtml = resource ? `
    <div class="action-row">
      <button type="button" class="action-btn" id="harvestBtn" data-shop-action="harvest" ${playerAdjacent ? '' : 'disabled'}>${resource.type === 'tree' ? 'Cut Tree' : 'Mine Rock'}</button>
    </div>` : '';
  if (shopHtml || harvestHtml) tileDetails.insertAdjacentHTML('beforeend', shopHtml + harvestHtml);

  const showTileActions = buyable || ownedByPlayer;
  colorPicker.style.display = showTileActions ? 'grid' : 'none';
  colorLabel.style.display = showTileActions ? 'block' : 'none';
  buyTileBtn.style.display = buyable ? 'block' : 'none';
  colorTileBtn.style.display = ownedByPlayer ? 'block' : 'none';
  buyTileBtn.disabled = !buyable || bananaBalance < BUY_COST;
  colorTileBtn.disabled = !recolorable || bananaBalance < RECOLOR_COST;
  const showCasinoPanel = casinoTile && !blocked;
  casinoPanel.style.display = showCasinoPanel ? 'block' : 'none';
  if (showCasinoPanel) {
    const activeGame = casinoZone?.gameId || null;
    casinoTitle.textContent = casinoZone ? `🎰 ${casinoZone.label}` : '🎲 Casino District';
    diceGame.style.display = activeGame === 'dice' && playerHere ? 'grid' : 'none';
    wheelGame.style.display = activeGame === 'wheel' && playerHere ? 'block' : 'none';
    blackjackGame.style.display = activeGame === 'blackjack' && playerHere ? 'block' : 'none';
    if (!casinoZone) casinoResult.textContent = 'This is the casino area. Stand on a yellow table zone to play.';
    else if (!playerHere) casinoResult.textContent = `Stand on this yellow ${casinoZone.label} zone to play.`;
    else if (!casinoResult.textContent || casinoResult.textContent.includes('Stand')) casinoResult.textContent = `You are at the ${casinoZone.label}.`;
  }
  updateWheelButton();
}

buyTileBtn.addEventListener('click', () => {
  if (!selectedTile || buyTileBtn.disabled) return;
  const { x, z } = selectedTile;
  const key = tileKey(x, z);
  if (bananaBalance < BUY_COST || ownedTiles.has(key) || !isExpansionChunk(x, z) || !isPlayerOnSelectedTile()) return;
  bananaBalance -= BUY_COST;
  ownedTiles.set(key, { owner: playerName, colorHex: selectedColor.hex, color: selectedColor.css, colorName: selectedColor.name });
  updateTileVisual(x, z);
  status.textContent = `Bought tile ${x}, ${z} in Chunk ${getChunkId(x, z)} for ${BUY_COST} banana`;
  addLog(`${playerName} bought tile ${x}, ${z}`);
  sendRemoteLog(`${playerName} bought tile ${x}, ${z}`);
  saveWorldNow();
  updateDashboard();
  updateInteractionPanel();
});

colorTileBtn.addEventListener('click', () => {
  if (!selectedTile || colorTileBtn.disabled) return;
  const { x, z } = selectedTile;
  const key = tileKey(x, z);
  const owned = ownedTiles.get(key);
  if (!owned || owned.owner !== playerName || bananaBalance < RECOLOR_COST || !isPlayerOnSelectedTile()) return;
  bananaBalance -= RECOLOR_COST;
  owned.colorHex = selectedColor.hex;
  owned.color = selectedColor.css;
  owned.colorName = selectedColor.name;
  updateTileVisual(x, z);
  status.textContent = `Changed tile ${x}, ${z} to ${selectedColor.name} for ${RECOLOR_COST} banana`;
  addLog(`${playerName} changed tile ${x}, ${z} to ${selectedColor.name}`);
  sendRemoteLog(`${playerName} changed tile ${x}, ${z} to ${selectedColor.name}`);
  saveWorldNow();
  updateDashboard();
  updateInteractionPanel();
});


colorPicker.addEventListener('click', (event) => {
  const button = event.target.closest('.color-choice');
  if (!button) return;
  const css = button.dataset.color;
  selectedColor = ownedColors.find((color) => color.css === css) || ownedColors[0];
  colorPicker.querySelectorAll('.color-choice').forEach((el) => el.classList.toggle('active', el === button));
  updateInteractionPanel();
});


function handlePanelAction(event) {
  const button = event.target.closest('[data-shop-action], #buyAxeBtn, #buyPickaxeBtn, #sellWoodBtn, #sellStoneBtn, #harvestBtn');
  if (!button) return false;
  const action = button.dataset.shopAction || button.id;
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  if (button.disabled) return true;
  if (action === 'buy-axe' || action === 'buyAxeBtn') buyTool('axe');
  else if (action === 'buy-pickaxe' || action === 'buyPickaxeBtn') buyTool('pickaxe');
  else if (action === 'sell-wood' || action === 'sellWoodBtn') sellResource('wood');
  else if (action === 'sell-stone' || action === 'sellStoneBtn') sellResource('stone');
  else if (action === 'harvest' || action === 'harvestBtn') harvestSelectedResource();
  return true;
}

// Use capture + pointerdown so the Three.js canvas/raycast handler can never swallow shop UI clicks.
['pointerdown', 'click'].forEach((eventName) => {
  document.addEventListener(eventName, (event) => {
    handlePanelAction(event);
  }, true);
});


function getPlayerTile() {
  return {
    x: Math.floor(player.position.x + WORLD_COLS / 2),
    z: Math.floor(player.position.z + WORLD_ROWS / 2),
  };
}

function isPlayerAtShopZone() {
  const pos = getPlayerTile();
  return shopZones.has(tileKey(pos.x, pos.z));
}

function debugShopState(action) {
  const pos = getPlayerTile();
  const atShop = isPlayerAtShopZone();
  console.log(`[Banana Empire shop] ${action}`, { pos, atShop, bananaBalance, inventorySlots });
  if (!atShop) {
    status.textContent = `Shop action blocked: player tile ${pos.x}, ${pos.z} is not a yellow shop tile.`;
  }
  return atShop;
}

function buyTool(tool) {
  if (!['axe', 'pickaxe'].includes(tool)) return;
  const standingAtShop = debugShopState(`buy ${tool}`);
  if (!standingAtShop) {
    status.textContent = 'Stand on a yellow shop tile to buy tools.';
    addLog('Shop: stand on a yellow shop tile first');
    return;
  }
  if (bananaBalance < TOOL_COST) { status.textContent = 'Not enough banana to buy that tool.'; return; }
  if (hasItem(tool)) { status.textContent = `You already own a ${tool}.`; return; }
  if (!addItem(tool, 1)) { status.textContent = 'Inventory full. Free up a slot first.'; return; }
  bananaBalance -= TOOL_COST;
  equippedTool = tool;
  status.textContent = `Bought ${tool} for ${TOOL_COST} banana and equipped it.`;
  addLog(`${playerName} bought ${tool} for ${TOOL_COST} banana`);
  updateDashboard();
  updateInteractionPanel();
}

function sellResource(type) {
  if (!isPlayerAtShopZone()) { status.textContent = 'Stand on a yellow shop tile to sell resources.'; return; }
  const amount = removeAllItem(type);
  if (amount <= 0) { status.textContent = `No ${type} to sell.`; return; }
  const payout = amount * RESOURCE_VALUE;
  bananaBalance += payout;
  status.textContent = `Sold ${amount} ${type} for ${payout} banana.`;
  addLog(`${playerName} sold ${amount} ${type} for ${payout} banana`);
  updateDashboard();
  updateInteractionPanel();
}

function harvestSelectedResource() {
  if (!selectedTile) return;
  const key = tileKey(selectedTile.x, selectedTile.z);
  const res = resources.get(key);
  if (!res) return;
  if (!isPlayerAdjacentTo(res.x, res.z)) { status.textContent = `Stand next to the ${res.type} first.`; return; }
  const needed = res.type === 'tree' ? 'axe' : 'pickaxe';
  if (equippedTool !== needed || !hasItem(needed)) { status.textContent = `Equip a ${needed} to ${res.type === 'tree' ? 'cut trees' : 'mine rocks'}.`; return; }
  const item = res.type === 'tree' ? 'wood' : 'stone';
  if (!addItem(item, RESOURCE_YIELD)) { status.textContent = `Inventory full. Need space for ${RESOURCE_YIELD} ${item}.`; return; }
  status.textContent = `${res.type === 'tree' ? 'Cut a tree' : 'Mined a rock'}: +${RESOURCE_YIELD} ${item}. It will respawn elsewhere in 1 minute.`;
  addLog(`${playerName} ${res.type === 'tree' ? 'cut a tree for' : 'mined'} ${RESOURCE_YIELD} ${item}`);
  removeResource(key);
  updateDashboard();
  updateInteractionPanel();
}

function weightedWheelPrize() {
  const roll = Math.random();
  if (roll < 0.52) return 1;
  if (roll < 0.82) return 10;
  if (roll < 0.96) return 100;
  if (roll < 0.992) return 500;
  return 1000;
}

function getWheelRemainingMs() {
  const last = Number(localStorage.getItem('bananaEmpireLastWheelSpin') || 0);
  return Math.max(0, WHEEL_COOLDOWN_MS - (Date.now() - last));
}

function updateWheelButton() {
  if (!spinWheelBtn) return;
  const remaining = getWheelRemainingMs();
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60000);
    spinWheelBtn.disabled = true;
    spinWheelBtn.textContent = `Lucky Wheel ready in ${mins}m`;
  } else {
    spinWheelBtn.disabled = false;
    spinWheelBtn.textContent = 'Spin Hourly Lucky Wheel';
  }
}

rollDiceBtn.addEventListener('click', () => {
  if (!isCurrentCasinoAllowed('dice')) { casinoResult.textContent = 'Stand at the dice table first.'; return; }
  const guess = Number(diceGuess.value);
  const bet = Math.floor(Number(diceBet.value));
  if (!Number.isInteger(guess) || guess < 0 || guess > 6) {
    casinoResult.textContent = 'Choose a dice guess from 0 to 6.';
    return;
  }
  if (!Number.isFinite(bet) || bet < DICE_MIN_BET || bet > DICE_MAX_BET) {
    casinoResult.textContent = 'Bet has to be between 10 and 100 banana.';
    return;
  }
  if (bananaBalance < bet) {
    casinoResult.textContent = 'Not enough banana for that bet.';
    return;
  }
  bananaBalance -= bet;
  diceAnim.textContent = '🎲';
  diceAnim.classList.remove('rolling');
  void diceAnim.offsetWidth;
  diceAnim.classList.add('rolling');
  const roll = Math.floor(Math.random() * 7);
  diceAnim.textContent = String(roll);
  if (roll === guess) {
    const payout = bet * 5;
    bananaBalance += payout;
    casinoResult.textContent = `Dice rolled ${roll}. You won ${payout} banana.`;
    status.textContent = `Casino win: +${payout - bet} banana profit`;
    addLog(`${playerName} won ${payout} banana in dice`);
  } else {
    casinoResult.textContent = `Dice rolled ${roll}. You lost ${bet} banana.`;
    status.textContent = `Casino roll lost ${bet} banana`;
    addLog(`${playerName} lost ${bet} banana in dice`);
  }
  updateDashboard();
});

spinWheelBtn.addEventListener('click', () => {
  if (!isCurrentCasinoAllowed('wheel')) { casinoResult.textContent = 'Stand at the lucky wheel first.'; return; }
  const remaining = getWheelRemainingMs();
  if (remaining > 0) {
    updateWheelButton();
    casinoResult.textContent = 'Lucky Wheel is still cooling down.';
    return;
  }
  const prize = weightedWheelPrize();
  wheelAnim.textContent = '🍌';
  wheelAnim.classList.remove('spinning');
  void wheelAnim.offsetWidth;
  wheelAnim.classList.add('spinning');
  wheelAnim.textContent = `${prize} 🍌`;
  bananaBalance += prize;
  localStorage.setItem('bananaEmpireLastWheelSpin', String(Date.now()));
  casinoResult.textContent = `Lucky Wheel prize: ${prize} banana.`;
  status.textContent = `Lucky Wheel won ${prize} banana`;
  addLog(`${playerName} won ${prize} banana on the lucky wheel`);
  updateDashboard();
  updateWheelButton();
});

function drawCard() { return 2 + Math.floor(Math.random() * 10); }
function handScore(cards) { return cards.reduce((sum, card) => sum + card, 0); }
function updateBlackjackUi(message = '') {
  if (!blackjackState) {
    blackjackCards.textContent = message || 'No hand yet.';
    hitBlackjackBtn.disabled = true;
    standBlackjackBtn.disabled = true;
    startBlackjackBtn.disabled = false;
    return;
  }
  const p = handScore(blackjackState.player);
  const dShown = blackjackState.done ? handScore(blackjackState.dealer) : blackjackState.dealer[0];
  blackjackCards.innerHTML = `Player: ${blackjackState.player.join(' + ')} = <strong>${p}</strong><br>Dealer: ${blackjackState.done ? blackjackState.dealer.join(' + ') : blackjackState.dealer[0] + ' + ?'} = <strong>${dShown}</strong>${message ? '<br>' + message : ''}`;
  hitBlackjackBtn.disabled = blackjackState.done;
  standBlackjackBtn.disabled = blackjackState.done;
  startBlackjackBtn.disabled = !blackjackState.done;
}
function finishBlackjack() {
  const st = blackjackState;
  while (handScore(st.dealer) < 17) st.dealer.push(drawCard());
  st.done = true;
  const p = handScore(st.player);
  const d = handScore(st.dealer);
  let message = '';
  if (p > 21) message = `Bust. You lost ${st.bet} banana.`;
  else if (d > 21 || p > d) { const win = st.bet * 2; bananaBalance += win; message = `You won ${win} banana.`; }
  else if (p === d) { bananaBalance += st.bet; message = 'Push. Bet returned.'; }
  else message = `Dealer wins. You lost ${st.bet} banana.`;
  casinoResult.textContent = `Blackjack: ${message}`;
  status.textContent = casinoResult.textContent;
  addLog(`${playerName} finished blackjack: ${message}`);
  updateBlackjackUi(message);
  updateDashboard();
}
startBlackjackBtn.addEventListener('click', () => {
  if (!isCurrentCasinoAllowed('blackjack')) { casinoResult.textContent = 'Stand at the blackjack table first.'; return; }
  const bet = Math.floor(Number(blackjackBet.value));
  if (!Number.isFinite(bet) || bet < BLACKJACK_MIN_BET || bet > BLACKJACK_MAX_BET) { casinoResult.textContent = 'Blackjack bet has to be between 10 and 100 banana.'; return; }
  if (bananaBalance < bet) { casinoResult.textContent = 'Not enough banana for that blackjack bet.'; return; }
  bananaBalance -= bet;
  blackjackState = { bet, player: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()], done: false };
  casinoResult.textContent = 'Blackjack hand started. Hit or stand.';
  if (handScore(blackjackState.player) >= 21) finishBlackjack(); else updateBlackjackUi();
  updateDashboard();
});
hitBlackjackBtn.addEventListener('click', () => {
  if (!blackjackState || blackjackState.done) return;
  blackjackState.player.push(drawCard());
  if (handScore(blackjackState.player) >= 21) finishBlackjack(); else updateBlackjackUi('You hit.');
});
standBlackjackBtn.addEventListener('click', () => {
  if (!blackjackState || blackjackState.done) return;
  finishBlackjack();
});



function serializeOwnedTiles() {
  return [...ownedTiles.entries()].map(([key, value]) => ({ key, ...value }));
}
function applyOwnedTiles(list = []) {
  ownedTiles.clear();
  for (const item of list) {
    if (!item || !item.key) continue;
    ownedTiles.set(item.key, {
      owner: item.owner || 'Unknown',
      colorHex: Number(item.colorHex) || 0x7be36d,
      color: item.color || '#7be36d',
      colorName: item.colorName || 'Green Light'
    });
  }
  for (const [key] of tileMap) {
    const [x, z] = key.split(',').map(Number);
    updateTileVisual(x, z);
  }
  updateDashboard();
  updateInteractionPanel();
}
function serializePlayer() {
  const pos = getPlayerTile ? getPlayerTile() : targetTile;
  return {
    bananaBalance,
    inventorySlots,
    equippedTool,
    targetTile,
    position: pos,
    lastWheelSpin: Number(localStorage.getItem('bananaEmpireLastWheelSpin') || 0)
  };
}
function applyPlayerData(data = {}) {
  bananaBalance = Number.isFinite(data.bananaBalance) ? data.bananaBalance : 1000;
  for (let i = 0; i < inventorySlots.length; i++) inventorySlots[i] = Array.isArray(data.inventorySlots) ? (data.inventorySlots[i] || null) : null;
  equippedTool = data.equippedTool || null;
  const spawn = data.position || data.targetTile || { x: 25, z: 25 };
  targetTile = data.targetTile || spawn;
  player.position.set(worldX(spawn.x), 0.08, worldZ(spawn.z));
  if (Number.isFinite(data.lastWheelSpin)) localStorage.setItem('bananaEmpireLastWheelSpin', String(data.lastWheelSpin));
  setTarget(targetTile.x, targetTile.z);
  updateDashboard();
  updateInteractionPanel();
}
function queueSavePlayer() {
  if (!loggedIn || !serverConnected || saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    apiPost('/api/save-player', { name: playerName, player: serializePlayer() });
  }, 120);
}
function saveWorldNow() {
  if (!loggedIn || !serverConnected) return;
  apiPost('/api/save-world', { name: playerName, ownedTiles: serializeOwnedTiles() });
}
function sendRemoteLog(message) {
  if (loggedIn && serverConnected) apiPost('/api/log', { name: playerName, message });
}
function createRemotePlayer(name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.76, 0.32), new THREE.MeshLambertMaterial({ color: 0x7fd8ff }));
  body.position.y = 0.65;
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.22, 0.34), new THREE.MeshLambertMaterial({ color: 0x244764 }));
  shirt.position.y = 0.86;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), new THREE.MeshLambertMaterial({ color: 0xffc58a }));
  head.position.y = 1.23;
  group.add(body, shirt, head);
  group.position.set(worldX(25), 0.08, worldZ(25));
  scene.add(group);
  const tag = document.createElement('div');
  tag.className = 'remote-name-tag';
  tag.textContent = name;
  document.body.appendChild(tag);
  remotePlayers.set(name, { group, tag, targetTile: { x: 25, z: 25 } });
  return remotePlayers.get(name);
}
function updateRemotePlayer(data = {}) {
  if (!data.name || data.name === playerName) return;
  const rp = remotePlayers.get(data.name) || createRemotePlayer(data.name);
  const pos = data.position || data.targetTile || { x: 25, z: 25 };
  rp.targetTile = data.targetTile || pos;
  rp.group.position.set(worldX(pos.x), 0.08, worldZ(pos.z));
}
function removeRemotePlayer(name) {
  const rp = remotePlayers.get(name);
  if (!rp) return;
  scene.remove(rp.group);
  rp.tag.remove();
  remotePlayers.delete(name);
}
function updateRemoteNameTags() {
  for (const [name, rp] of remotePlayers) {
    const pos = rp.group.position.clone();
    pos.y += 1.75;
    pos.project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    rp.tag.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
  }
}
async function apiPost(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('LAN API error:', err);
    return null;
  }
}

async function apiGet(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('LAN API error:', err);
    return null;
  }
}

function applyServerState(msg) {
  if (!msg) return;
  if (msg.world) applyOwnedTiles(msg.world.ownedTiles || []);
  if (Array.isArray(msg.onlinePlayers)) {
    const seen = new Set();
    for (const p of msg.onlinePlayers) {
      if (!p || !p.name || p.name === playerName) continue;
      seen.add(p.name);
      updateRemotePlayer(p);
    }
    for (const name of [...remotePlayers.keys()]) {
      if (!seen.has(name)) removeRemotePlayer(name);
    }
  }
  if (Array.isArray(msg.logs)) {
    for (const entry of msg.logs) {
      if (entry && entry.message && entry.id && !seenLogIds.has(entry.id)) {
        seenLogIds.add(entry.id);
        addLog(entry.message);
      }
    }
  }
}
const seenLogIds = new Set();

function startPolling() {
  clearInterval(pollingTimer);
  pollingTimer = setInterval(async () => {
    if (!loggedIn || !serverConnected) return;
    const state = await apiGet(`/api/state?name=${encodeURIComponent(playerName)}`);
    applyServerState(state);
  }, 750);
}

async function connectLanServer() {
  loginStatus.textContent = 'Checking LAN server...';
  const ping = await apiGet('/api/ping');
  if (!ping || !ping.ok) {
    loginStatus.textContent = 'Could not reach LAN server. Restart start.bat if needed.';
    loginBtn.disabled = true;
    return;
  }
  serverConnected = true;
  loginStatus.textContent = 'Connected. Choose a name to enter.';
  loginBtn.disabled = false;
}
async function doLogin() {
  const name = (loginNameInput.value || localStorage.getItem('bananaEmpirePlayerName') || 'Player').trim().slice(0, 18);
  if (!name || !serverConnected) return;
  loginBtn.disabled = true;
  loginStatus.textContent = `Loading ${name}...`;
  const msg = await apiPost('/api/login', { name });
  if (!msg || !msg.player) {
    loginStatus.textContent = 'Login failed. Check the server window.';
    loginBtn.disabled = false;
    return;
  }
  loggedIn = true;
  loginOverlay.style.display = 'none';
  playerName = msg.player.name;
  localStorage.setItem('bananaEmpirePlayerName', playerName);
  applyOwnedTiles(msg.world?.ownedTiles || []);
  applyPlayerData(msg.player);
  for (const p of msg.onlinePlayers || []) updateRemotePlayer(p);
  addLog(`${playerName} entered the LAN world`);
  sendRemoteLog(`${playerName} joined`);
  startPolling();
}

function updateDashboard() {
  dashName.textContent = playerName;
  bananaAmount.textContent = bananaBalance.toLocaleString();
  ownedTilesAmount.textContent = [...ownedTiles.values()].filter(t => t.owner === playerName).length.toLocaleString();
  equippedToolAmount.textContent = equippedTool ? equippedTool : 'None';
  nameTag.textContent = playerName;
  const labels = {
    axe: '🪓 Axe',
    pickaxe: '⛏ Pickaxe',
    wood: '🪵 Wood',
    stone: '🪨 Stone',
  };
  inventoryGrid.innerHTML = inventorySlots.map((slot) => {
    if (!slot) return '<div class="inv-slot empty">Empty</div>';
    const isTool = slot.type === 'axe' || slot.type === 'pickaxe';
    const active = isTool && equippedTool === slot.type ? ' equipped' : '';
    const toolClass = isTool ? ' tool' : '';
    return `<div class="inv-slot${toolClass}${active}" data-tool="${isTool ? slot.type : ''}">${labels[slot.type] || slot.type}<br>x${slot.amount}</div>`;
  }).join('');
  queueSavePlayer();
}

inventoryGrid.addEventListener('click', (event) => {
  const slot = event.target.closest('.inv-slot.tool');
  if (!slot) return;
  const tool = slot.dataset.tool;
  if (!tool || !hasItem(tool)) return;
  equippedTool = equippedTool === tool ? null : tool;
  status.textContent = equippedTool ? `Equipped ${equippedTool}.` : 'Unequipped tool.';
  updateDashboard();
  updateInteractionPanel();
});

editNameBtn.addEventListener('click', () => {
  const next = prompt('Choose your Banana Empire name:', playerName);
  if (!next) return;
  playerName = next.trim().slice(0, 18) || playerName;
  localStorage.setItem('bananaEmpirePlayerName', playerName);
  updateDashboard();
});

function updateNameTag() {
  const pos = player.position.clone();
  pos.y += 1.75;
  pos.project(camera);
  const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  nameTag.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
}

function drawIsoTile(ctx, x, z, fill, metrics) {
  const { centerX, topY, tileW, tileH } = metrics;
  const cx = centerX + (x - z) * tileW / 2;
  const cy = topY + (x + z) * tileH / 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx, cy - tileH / 2);
  ctx.lineTo(cx + tileW / 2, cy);
  ctx.lineTo(cx, cy + tileH / 2);
  ctx.lineTo(cx - tileW / 2, cy);
  ctx.closePath();
  ctx.fill();
}

let minimapMetrics = null;
function drawMinimap() {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const tileW = w / WORLD_COLS * 1.62;
  const tileH = tileW * 0.5;
  const centerX = w / 2;
  const topY = 12;
  minimapMetrics = { centerX, topY, tileW, tileH };

  minimapCtx.clearRect(0, 0, w, h);
  minimapCtx.fillStyle = '#102016';
  minimapCtx.fillRect(0, 0, w, h);

  for (let z = 0; z < WORLD_ROWS; z++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      let fill = isExpansionChunk(x, z) ? '#686d69' : (isCasinoTile(x,z) ? '#3d3448' : '#2f7c3c');
      if (casinoZones.has(tileKey(x, z))) fill = '#ffdf4d';
      const owned = ownedTiles.get(tileKey(x, z));
      if (owned) fill = owned.color;
      if (isPlaza(x, z)) fill = '#a7aba2';
      else if (isPath(x, z)) fill = '#a8875c';
      if (isBlocked(x, z)) fill = '#173b22';
      drawIsoTile(minimapCtx, x, z, fill, minimapMetrics);
    }
  }

  const playerX = player.position.x + WORLD_COLS / 2;
  const playerZ = player.position.z + WORLD_ROWS / 2;
  const px = centerX + (playerX - playerZ) * tileW / 2;
  const py = topY + (playerX + playerZ) * tileH / 2;
  minimapCtx.fillStyle = '#ffe15a';
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
  minimapCtx.fill();

  const camX = cameraTarget.x + WORLD_COLS / 2;
  const camZ = cameraTarget.z + WORLD_ROWS / 2;
  const cx = centerX + (camX - camZ) * tileW / 2;
  const cy = topY + (camX + camZ) * tileH / 2;
  minimapCtx.strokeStyle = 'rgba(255,255,255,.9)';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, cy - 13);
  minimapCtx.lineTo(cx + 22, cy);
  minimapCtx.lineTo(cx, cy + 13);
  minimapCtx.lineTo(cx - 22, cy);
  minimapCtx.closePath();
  minimapCtx.stroke();
}

function minimapEventToTile(event) {
  const rect = minimapCanvas.getBoundingClientRect();
  const scaleX = minimapCanvas.width / rect.width;
  const scaleY = minimapCanvas.height / rect.height;
  const mx = (event.clientX - rect.left) * scaleX;
  const my = (event.clientY - rect.top) * scaleY;
  const { centerX, topY, tileW, tileH } = minimapMetrics || { centerX: 90, topY: 12, tileW: 5.1, tileH: 2.55 };
  const a = (mx - centerX) / (tileW / 2);
  const b = (my - topY) / (tileH / 2);
  const x = (a + b) / 2;
  const z = (b - a) / 2;
  return { x: THREE.MathUtils.clamp(x, 0, WORLD_COLS), z: THREE.MathUtils.clamp(z, 0, WORLD_ROWS) };
}

let minimapDragging = false;
function panToMinimapEvent(event) {
  const pos = minimapEventToTile(event);
  cameraTarget.set(pos.x - WORLD_COLS / 2, 0, pos.z - WORLD_ROWS / 2);
  clampCameraTarget();
}
minimapCanvas.addEventListener('pointerdown', (e) => { minimapDragging = true; panToMinimapEvent(e); });
window.addEventListener('pointermove', (e) => { if (minimapDragging) panToMinimapEvent(e); });
window.addEventListener('pointerup', () => { minimapDragging = false; });

loginNameInput.value = localStorage.getItem('bananaEmpirePlayerName') || '';
loginBtn.disabled = true;
loginBtn.addEventListener('click', doLogin);
loginNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
connectLanServer();
buildColorPicker();
updateDashboard();
addLog('Banana Empire v0.1.2 LAN loaded');

let lastTime = performance.now();
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  updateKeyboardCamera(dt);

  const target = new THREE.Vector3(worldX(targetTile.x), 0.08, worldZ(targetTile.z));
  const delta = target.clone().sub(player.position);
  const distance = delta.length();
  if (distance > 0.03) {
    const step = Math.min(distance, MOVE_SPEED * dt);
    player.position.add(delta.normalize().multiplyScalar(step));
    player.lookAt(target.x, player.position.y, target.z);
  } else if (status.textContent.startsWith('Walking')) {
    status.textContent = `Arrived at tile ${targetTile.x}, ${targetTile.z}`;
  }

  water.rotation.y += 0.8 * dt;
  updateCamera();
  updateNameTag();
  updateRemoteNameTags();
  updateInteractionPanel();
  drawMinimap();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setTarget(25, 25);
animate();
