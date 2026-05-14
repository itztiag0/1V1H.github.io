// === 1v1.LOL GAME ENGINE ===
const G = 4, PH = 1.7, SPD = 12, JMP = 10, GRV = 28, SENS = 0.002, BCOST = 10;
const WPN = [
    { n: 'PUÑOS', dmg: 25, rate: 400, rng: 5, c: 0xffa07a, mag: Infinity, maxMag: Infinity, reloading: false, reloadTime: 0 },
    { n: 'ESPADA', dmg: 40, rate: 500, rng: 8, c: 0xaaaaaa, mag: Infinity, maxMag: Infinity, reloading: false, reloadTime: 0 },
    { n: 'ESCUDO', dmg: 30, rate: 600, rng: 6, c: 0x42a5f5, mag: Infinity, maxMag: Infinity, reloading: false, reloadTime: 0 }
];
const keys = {};
let locked = false, mode = 'combat', selW = 0, selB = 0, bRot = 0, pHP = 100, pShield = 0, res = 500, bCnt = 0;
let pInv = [0];
let pConsumables = [];
let editSel = null, editOrigColor = null, editMoving = false;
let vel = new THREE.Vector3(), canJ = false, lastShot = 0, builds = [], tracers = [];
let euler = new THREE.Euler(0, 0, 0, 'YXZ');

// === BATTLE ROYALE STATE ===
let gamePhase = 'menu'; // menu, bus, dropping, playing, victory
let kills = 0, totalBots = 30, botsAlive = 30;
let busGroup = null, busT = 0;
let chests = [], lootItems = [], chestSpawns = [];
let stormRadius = 400, stormCenter = { x: 0, z: 0 }, stormTimer = 0, lastStormDmgT = 0;
const LOOT_TYPES = [
    { n: 'ESPADA', type: 'weapon', wpnIdx: 1, color: 0xaaaaaa },
    { n: 'ESCUDO', type: 'weapon', wpnIdx: 2, color: 0x42a5f5 },
    { n: 'MEDKIT', type: 'heal', amount: 50, color: 0x00e676 },
    { n: 'SHIELD', type: 'shield', amount: 50, color: 0x42a5f5 },
    { n: 'MINI SHIELD', type: 'shield', amount: 25, color: 0x1e88e5 },
    { n: 'BANDAGE', type: 'heal', amount: 15, color: 0x66bb6a }
];

// === MULTIPLAYER VARIABLES ===
let socket = null;
let networkPlayers = {};

if (typeof io !== 'undefined') {
    socket = io();

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) {
                addNetworkPlayer(players[id]);
            }
        });
    });

    socket.on('newPlayer', (playerInfo) => {
        addNetworkPlayer(playerInfo);
    });

    socket.on('playerMoved', (playerInfo) => {
        if (networkPlayers[playerInfo.id]) {
            networkPlayers[playerInfo.id].position.set(playerInfo.x, playerInfo.y, playerInfo.z);
            networkPlayers[playerInfo.id].rotation.y = playerInfo.rotation;
        }
    });

    socket.on('playerDisconnected', (id) => {
        if (networkPlayers[id]) {
            scene.remove(networkPlayers[id]);
            delete networkPlayers[id];
        }
    });
}

function addNetworkPlayer(info) {
    const geo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00 }); // Green for real players
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(info.x, info.y, info.z);
    scene.add(mesh);
    networkPlayers[info.id] = mesh;
}

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.004);

let stormMesh;
{
    const stormGeo = new THREE.CylinderGeometry(1, 1, 400, 32, 1, true);
    const stormMat = new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    stormMesh = new THREE.Mesh(stormGeo, stormMat);
    stormMesh.position.set(0, 100, 0);
    scene.add(stormMesh);
}
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
cam.position.set(0, PH + getTerrainH(0, 10), 10);
const ren = new THREE.WebGLRenderer({ antialias: true });
ren.setSize(innerWidth, innerHeight);
ren.setPixelRatio(Math.min(devicePixelRatio, 2));
ren.shadowMap.enabled = true;
ren.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(ren.domElement);

// Lights (will be animated for day/night cycle)
const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambLight);
const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, 0.4);
scene.add(hemiLight);
const dL = new THREE.DirectionalLight(0xffffff, 0.8);
dL.position.set(30, 50, 20); dL.castShadow = true;
dL.shadow.mapSize.set(1024, 1024);
dL.shadow.camera.left = -120; dL.shadow.camera.right = 120;
dL.shadow.camera.top = 120; dL.shadow.camera.bottom = -120;
dL.shadow.camera.far = 300;
scene.add(dL);

// === DAY/NIGHT CYCLE ===
const DAY_DURATION = 120; // seconds for a full cycle
let dayTime = 0.25; // start at dawn (0=midnight, 0.25=dawn, 0.5=noon, 0.75=sunset, 1=midnight)

function lerpColor(a, b, t) {
    return new THREE.Color(
        a.r + (b.r - a.r) * t,
        a.g + (b.g - a.g) * t,
        a.b + (b.b - a.b) * t
    );
}

const skyColors = {
    night: new THREE.Color(0x0a0e2a),
    dawn: new THREE.Color(0xff9966),
    morning: new THREE.Color(0x87CEEB),
    noon: new THREE.Color(0x6fb8e0),
    sunset: new THREE.Color(0xff6633),
    dusk: new THREE.Color(0x2a1a4a)
};

function updateDayCycle(dt) {
    dayTime = (dayTime + dt / DAY_DURATION) % 1.0;
    let skyColor, fogColor, sunIntensity, ambIntensity, sunColor;
    const t = dayTime;

    if (t < 0.2) { // Night (0.0 - 0.2)
        const p = t / 0.2;
        skyColor = lerpColor(skyColors.night, skyColors.dawn, p);
        sunIntensity = 0.1 + p * 0.3;
        ambIntensity = 0.15 + p * 0.15;
        sunColor = lerpColor(new THREE.Color(0x333366), new THREE.Color(0xff8844), p);
    } else if (t < 0.35) { // Dawn to morning (0.2 - 0.35)
        const p = (t - 0.2) / 0.15;
        skyColor = lerpColor(skyColors.dawn, skyColors.morning, p);
        sunIntensity = 0.4 + p * 0.4;
        ambIntensity = 0.3 + p * 0.2;
        sunColor = lerpColor(new THREE.Color(0xff8844), new THREE.Color(0xffffff), p);
    } else if (t < 0.65) { // Day (0.35 - 0.65)
        const p = (t - 0.35) / 0.3;
        skyColor = lerpColor(skyColors.morning, skyColors.noon, Math.sin(p * Math.PI));
        sunIntensity = 0.8;
        ambIntensity = 0.5;
        sunColor = new THREE.Color(0xffffff);
    } else if (t < 0.8) { // Sunset (0.65 - 0.8)
        const p = (t - 0.65) / 0.15;
        skyColor = lerpColor(skyColors.noon, skyColors.sunset, p);
        sunIntensity = 0.8 - p * 0.4;
        ambIntensity = 0.5 - p * 0.2;
        sunColor = lerpColor(new THREE.Color(0xffffff), new THREE.Color(0xff6633), p);
    } else { // Night (0.8 - 1.0)
        const p = (t - 0.8) / 0.2;
        skyColor = lerpColor(skyColors.dusk, skyColors.night, p);
        sunIntensity = 0.4 - p * 0.3;
        ambIntensity = 0.3 - p * 0.15;
        sunColor = lerpColor(new THREE.Color(0xff6633), new THREE.Color(0x333366), p);
    }

    scene.background = skyColor;
    scene.fog.color = skyColor;
    dL.intensity = sunIntensity;
    dL.color.copy(sunColor);
    ambLight.intensity = ambIntensity;
    hemiLight.skyColor = skyColor;

    // Move sun position in arc
    const sunAngle = t * Math.PI * 2;
    dL.position.set(Math.cos(sunAngle) * 60, Math.sin(sunAngle) * 50 + 10, 20);
}

// Terrain Function - perfectly flat for 1v1.lol style building
function getTerrainH(x, z) {
    return 0;
}

// Texture loader
const texLoader = new THREE.TextureLoader();

// Helper: load a texture with wrapping + repeat configured
function loadTex(file, rx, ry) {
    const t = texLoader.load(file);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.encoding = THREE.sRGBEncoding;
    return t;
}

// === ISLAND GROUND (terrain mesh with relief) ===
const grassTex = loadTex('grass_texture.png', 40, 40);
const flGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
// Displace vertices to match getTerrainH
const posAttr = flGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i);
    posAttr.setZ(i, getTerrainH(x, -y));
}
flGeo.computeVertexNormals();
const fl = new THREE.Mesh(flGeo, new THREE.MeshStandardMaterial({ map: grassTex, color: 0xffffff, roughness: 0.9 }));
fl.rotation.x = -Math.PI / 2;
fl.receiveShadow = true;
scene.add(fl);

// Sand beach strips around the island edges
const sandMat = new THREE.MeshStandardMaterial({ map: loadTex('sand_texture.png', 40, 2), color: 0xffffff, roughness: 0.95 });
const beachN = new THREE.Mesh(new THREE.PlaneGeometry(440, 20), sandMat);
beachN.rotation.x = -Math.PI / 2; beachN.position.set(0, -0.01, -210); beachN.receiveShadow = true; scene.add(beachN);
const beachS = new THREE.Mesh(new THREE.PlaneGeometry(440, 20), sandMat);
beachS.rotation.x = -Math.PI / 2; beachS.position.set(0, -0.01, 210); beachS.receiveShadow = true; scene.add(beachS);
const sandMat2 = new THREE.MeshStandardMaterial({ map: loadTex('sand_texture.png', 2, 40), color: 0xffffff, roughness: 0.95 });
const beachE = new THREE.Mesh(new THREE.PlaneGeometry(20, 440), sandMat2);
beachE.rotation.x = -Math.PI / 2; beachE.position.set(210, -0.01, 0); beachE.receiveShadow = true; scene.add(beachE);
const beachW = new THREE.Mesh(new THREE.PlaneGeometry(20, 440), sandMat2);
beachW.rotation.x = -Math.PI / 2; beachW.position.set(-210, -0.01, 0); beachW.receiveShadow = true; scene.add(beachW);

// === BARK TEXTURE LOADING ===
function loadBarkTex(repeatX, repeatY) {
    return loadTex('bark_texture.png', repeatX || 2, repeatY || 2);
}

// Create bark materials — use white color so texture shows at full brightness
function makeBarkMat(roughness, repeatX, repeatY) {
    return new THREE.MeshStandardMaterial({
        map: loadBarkTex(repeatX, repeatY),
        color: 0xffffff,
        roughness: roughness || 0.85
    });
}

// === DESTRUCTIBLE MAP OBJECTS ===
// All map objects go into builds[] so they have collision + are destructible
const wallMat = makeBarkMat(0.85, 2, 2);
const roofMat = makeBarkMat(0.75, 3, 3);
const floorMat2 = makeBarkMat(0.9, 2, 2);
const concMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.6 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0xccffff, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
const crateMat = makeBarkMat(0.75, 1, 1);
const barrelMat = makeBarkMat(0.7, 2, 3);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.9 });
const trimMat = makeBarkMat(0.6, 1, 4);
const doorMat = makeBarkMat(0.75, 1, 2);
const chimMat = makeBarkMat(0.85, 1, 2);
const railMat = new THREE.MeshStandardMaterial({ color: 0x616161, roughness: 0.4, metalness: 0.5 });

let currentTerrainH = 0;
function addPart(geo, mat, x, y, z, hp, type) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.set(x, y + currentTerrainH, z); m.castShadow = true; m.receiveShadow = true;
    m.userData = { type: type || 'wall', hp: hp || 80 };
    scene.add(m); builds.push(m); return m;
}
function addDoor(cx, cz, y, w, h, d, hp, closedRy) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(w / 2, 0, 0);
    const m = new THREE.Mesh(geo, doorMat.clone());
    m.position.set(cx - w / 2, y + currentTerrainH, cz);
    m.rotation.y = closedRy || 0;
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { type: 'door', hp: hp || 80, opened: false, closedRy: closedRy || 0, openRy: (closedRy || 0) + Math.PI / 2 };
    scene.add(m); builds.push(m); return m;
}
function addPartR(geo, mat, x, y, z, rx, ry, rz, hp, type) {
    const m = addPart(geo, mat, x, y, z, hp, type);
    m.rotation.set(rx || 0, ry || 0, rz || 0); return m;
}

// --- HOUSE 1 (detailed cabin) ---
// Furniture materials
const fabricMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 0.9 });
const cushionMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.8 });
const tvMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.5 });
const tvScreenMat = new THREE.MeshStandardMaterial({ color: 0x1a237e, emissive: 0x1a237e, emissiveIntensity: 0.3, roughness: 0.1 });
const rugMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.95 });
const bookMat1 = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.7 });
const bookMat2 = new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.7 });
const bookMat3 = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.7 });
const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.3, metalness: 0.4 });
const bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe3f2fd, roughness: 0.9 });

// Furniture: add a table at (x, z) relative, inside a building
function addTable(cx, cz) {
    addPart(new THREE.BoxGeometry(1.4, 0.08, 0.9), floorMat2, cx, 0.85, cz, 30, 'wall');
    [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].forEach(([lx, lz]) => {
        addPart(new THREE.BoxGeometry(0.06, 0.85, 0.06), trimMat, cx + lx, 0.42, cz + lz, 20, 'wall');
    });
}
function addChair(cx, cz, rot) {
    const m = addPart(new THREE.BoxGeometry(0.5, 0.06, 0.5), floorMat2, cx, 0.5, cz, 20, 'wall');
    addPart(new THREE.BoxGeometry(0.5, 0.5, 0.06), floorMat2, cx, 0.75, cz + 0.22, 20, 'wall');
    [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([lx, lz]) => {
        addPart(new THREE.BoxGeometry(0.05, 0.5, 0.05), trimMat, cx + lx, 0.25, cz + lz, 15, 'wall');
    });
}
function addBed(cx, cz) {
    addPart(new THREE.BoxGeometry(1.2, 0.35, 2.0), bedMat, cx, 0.35, cz, 40, 'wall');
    addPart(new THREE.BoxGeometry(1.2, 0.15, 2.0), fabricMat, cx, 0.55, cz, 30, 'wall');
    addPart(new THREE.BoxGeometry(0.4, 0.12, 0.35), pillowMat, cx - 0.3, 0.65, cz - 0.75, 10, 'wall');
    addPart(new THREE.BoxGeometry(0.4, 0.12, 0.35), pillowMat, cx + 0.3, 0.65, cz - 0.75, 10, 'wall');
    addPart(new THREE.BoxGeometry(1.25, 0.5, 0.1), doorMat, cx, 0.45, cz - 0.95, 30, 'wall');
}
function addBookshelf(cx, cz) {
    addPart(new THREE.BoxGeometry(1.0, 1.8, 0.4), doorMat, cx, 0.9, cz, 40, 'wall');
    const mats = [bookMat1, bookMat2, bookMat3, bookMat1, bookMat2];
    for (let r = 0; r < 3; r++) {
        for (let b = 0; b < 3; b++) {
            addPart(new THREE.BoxGeometry(0.12, 0.25, 0.3), mats[(r + b) % 5], cx - 0.3 + b * 0.3, 0.3 + r * 0.55, cz, 5, 'wall');
        }
    }
}
function addSofa(cx, cz) {
    addPart(new THREE.BoxGeometry(2.0, 0.35, 0.8), fabricMat, cx, 0.35, cz, 40, 'wall');
    addPart(new THREE.BoxGeometry(2.0, 0.4, 0.12), fabricMat, cx, 0.65, cz + 0.34, 30, 'wall');
    addPart(new THREE.BoxGeometry(0.15, 0.25, 0.8), fabricMat, cx - 0.92, 0.55, cz, 20, 'wall');
    addPart(new THREE.BoxGeometry(0.15, 0.25, 0.8), fabricMat, cx + 0.92, 0.55, cz, 20, 'wall');
    addPart(new THREE.BoxGeometry(0.55, 0.1, 0.6), cushionMat, cx - 0.5, 0.55, cz - 0.05, 10, 'wall');
    addPart(new THREE.BoxGeometry(0.55, 0.1, 0.6), cushionMat, cx + 0.5, 0.55, cz - 0.05, 10, 'wall');
}

function buildHouse1(cx, cz) {
    currentTerrainH = getTerrainH(cx, cz);
    chestSpawns.push({ x: cx, z: cz });
    const w = 8, h = 4, d = 8;
    // Walls
    addPart(new THREE.BoxGeometry(w, h, 0.3), wallMat, cx, h / 2, cz - d / 2, 80, 'wall');
    addPart(new THREE.BoxGeometry(w, h, 0.3), wallMat, cx, h / 2, cz + d / 2, 80, 'wall');
    addPart(new THREE.BoxGeometry(0.3, h, d), wallMat, cx - w / 2, h / 2, cz, 80, 'wall');
    addPart(new THREE.BoxGeometry(0.3, h, d), wallMat, cx + w / 2, h / 2, cz, 80, 'wall');
    // Foundation & Floor
    addPart(new THREE.BoxGeometry(w, 8, d), floorMat2, cx, -3.9, cz, 120, 'floor');
    addPart(new THREE.BoxGeometry(w, 0.2, d), floorMat2, cx, 0.1, cz, 120, 'floor');
    // Roof
    addPart(new THREE.BoxGeometry(w + 1, 0.3, d + 1), roofMat, cx, h + 0.15, cz, 100, 'floor');
    // Roof ridge (triangular shape on top)
    addPartR(new THREE.CylinderGeometry(0, 1.2, d + 1, 4), roofMat, cx, h + 0.8, cz, 0, Math.PI / 4, 0, 80, 'wall');
    // Chimney
    addPart(new THREE.BoxGeometry(0.8, 2, 0.8), chimMat, cx + w / 2 - 1.2, h + 1.2, cz - d / 2 + 1, 60, 'wall');
    addPart(new THREE.BoxGeometry(1.0, 0.15, 1.0), chimMat, cx + w / 2 - 1.2, h + 2.25, cz - d / 2 + 1, 60, 'wall');
    // Door (front wall)
    addDoor(cx, cz + d / 2, 1.4, 1.4, 2.8, 0.35, 60, 0);
    // Door handle
    addPart(new THREE.SphereGeometry(0.06, 6, 6), railMat, cx + 0.5, 1.4, cz + d / 2 + 0.2, 20, 'wall');
    // Window frames (both sides)
    [-1, 1].forEach(s => {
        addPart(new THREE.BoxGeometry(0.1, 1.5, 2), glassMat, cx + s * w / 2 + s * 0.1, h / 2 + 0.5, cz, 30, 'wall');
        addPart(new THREE.BoxGeometry(0.15, 0.1, 2.2), trimMat, cx + s * w / 2 + s * 0.1, h / 2 + 1.3, cz, 40, 'wall');
        addPart(new THREE.BoxGeometry(0.2, 0.08, 2.3), trimMat, cx + s * w / 2 + s * 0.12, h / 2 - 0.25, cz, 40, 'wall');
        addPart(new THREE.BoxGeometry(0.15, 1.6, 0.1), trimMat, cx + s * w / 2 + s * 0.1, h / 2 + 0.5, cz + 1.05, 40, 'wall');
        addPart(new THREE.BoxGeometry(0.15, 1.6, 0.1), trimMat, cx + s * w / 2 + s * 0.1, h / 2 + 0.5, cz - 1.05, 40, 'wall');
    });
    // Front window
    addPart(new THREE.BoxGeometry(1.5, 1.2, 0.1), glassMat, cx - 2, h / 2 + 0.5, cz + d / 2 + 0.1, 30, 'wall');
    addPart(new THREE.BoxGeometry(1.7, 0.08, 0.2), trimMat, cx - 2, h / 2 - 0.12, cz + d / 2 + 0.15, 40, 'wall');
    // Porch
    addPart(new THREE.BoxGeometry(w + 2, 0.15, 2), floorMat2, cx, 0.08, cz + d / 2 + 1.2, 80, 'floor');
    [-1, 1].forEach(s => {
        addPart(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 8), trimMat, cx + s * (w / 2 + 0.5), 1.4, cz + d / 2 + 2, 60, 'wall');
    });
    addPart(new THREE.BoxGeometry(w + 2, 0.12, 2.2), roofMat, cx, 2.85, cz + d / 2 + 1.2, 60, 'floor');
    addPart(new THREE.BoxGeometry(2, 0.15, 0.5), concMat, cx, 0.08, cz + d / 2 + 2.5, 50, 'floor');
    // Corner trim (Logs)
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 8), trimMat.clone());
        trunk.position.set(cx + sx * w / 2, h / 2, cz + sz * d / 2); trunk.castShadow = true; trunk.receiveShadow = true;
        trunk.userData = { type: 'wall', hp: 60 }; scene.add(trunk); builds.push(trunk);
    });
    addPart(new THREE.BoxGeometry(w + 0.3, 0.2, 0.15), trimMat, cx, 0.1, cz + d / 2 + 0.08, 50, 'wall');
    addPart(new THREE.BoxGeometry(w + 0.3, 0.2, 0.15), trimMat, cx, 0.1, cz - d / 2 - 0.08, 50, 'wall');
    // === INTERIOR FURNITURE ===
    addBed(cx + 2.4, cz - 1.5);
    addTable(cx - 1.5, cz);
    addChair(cx - 2.2, cz + 0.8);
    addChair(cx - 0.8, cz + 0.8);
    addBookshelf(cx + 3.2, cz + 1.8);
    // Rug
    addPart(new THREE.BoxGeometry(2.5, 0.02, 1.8), rugMat, cx - 1.5, 0.22, cz, 10, 'floor');
    // Nightstand
    addPart(new THREE.BoxGeometry(0.5, 0.5, 0.5), doorMat, cx + 3.5, 0.45, cz + 0.5, 20, 'wall');
    // Lamp on nightstand
    addPart(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), railMat, cx + 3.5, 0.85, cz + 0.5, 10, 'wall');
    addPart(new THREE.CylinderGeometry(0.15, 0.08, 0.15, 8), new THREE.MeshStandardMaterial({ color: 0xfff9c4, emissive: 0xfff176, emissiveIntensity: 0.3 }), cx + 3.5, 1.05, cz + 0.5, 10, 'wall');
}

// --- BUILDING (tall, 2 floors with balcony) ---
function buildTower(cx, cz) {
    currentTerrainH = getTerrainH(cx, cz);
    chestSpawns.push({ x: cx, z: cz });
    chestSpawns.push({ x: cx, z: cz - 2 }); // 2nd floor chest
    const w = 8, d = 8, fh = 4;
    for (let f = 0; f < 2; f++) {
        const y = f * fh;
        // 4 walls per floor
        addPart(new THREE.BoxGeometry(w, fh, 0.3), concMat, cx, y + fh / 2, cz - d / 2, 120, 'wall');
        addPart(new THREE.BoxGeometry(w, fh, 0.3), concMat, cx, y + fh / 2, cz + d / 2, 120, 'wall');
        addPart(new THREE.BoxGeometry(0.3, fh, d), concMat, cx - w / 2, y + fh / 2, cz, 120, 'wall');
        addPart(new THREE.BoxGeometry(0.3, fh, d), concMat, cx + w / 2, y + fh / 2, cz, 120, 'wall');
        // Floor/ceiling
        if (f > 0) addPart(new THREE.BoxGeometry(w, 0.3, d), concMat, cx, y + 0.15, cz, 150, 'floor');
        // Windows with frames on each side
        [-1, 1].forEach(s => {
            addPart(new THREE.BoxGeometry(0.1, 1.2, 1.5), glassMat, cx + s * w / 2 + s * 0.1, y + fh / 2 + 0.5, cz, 20, 'wall');
            // Window frame
            addPart(new THREE.BoxGeometry(0.12, 0.08, 1.7), trimMat, cx + s * w / 2 + s * 0.1, y + fh / 2 + 1.15, cz, 30, 'wall');
            addPart(new THREE.BoxGeometry(0.15, 0.06, 1.8), trimMat, cx + s * w / 2 + s * 0.12, y + fh / 2 - 0.1, cz, 30, 'wall');
        });
        // Front windows
        addPart(new THREE.BoxGeometry(1.2, 1.2, 0.1), glassMat, cx - 1.3, y + fh / 2 + 0.5, cz + d / 2 + 0.1, 20, 'wall');
        addPart(new THREE.BoxGeometry(1.2, 1.2, 0.1), glassMat, cx + 1.3, y + fh / 2 + 0.5, cz + d / 2 + 0.1, 20, 'wall');
        // Floor trim line
        addPart(new THREE.BoxGeometry(w + 0.2, 0.12, 0.15), concMat, cx, y + 0.06, cz + d / 2 + 0.08, 80, 'wall');
    }
    // Corner pillars (Logs)
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8.5, 8), concMat.clone());
        pillar.position.set(cx + sx * w / 2, 4.25, cz + sz * d / 2); pillar.castShadow = true; pillar.receiveShadow = true;
        pillar.userData = { type: 'wall', hp: 150 }; scene.add(pillar); builds.push(pillar);
    });
    // Roof
    addPart(new THREE.BoxGeometry(w + 1, 0.3, d + 1), concMat, cx, 8.15, cz, 150, 'floor');
    // Roof edge trim
    addPart(new THREE.BoxGeometry(w + 1.2, 0.25, 0.15), concMat, cx, 8.4, cz + d / 2 + 0.55, 80, 'wall');
    addPart(new THREE.BoxGeometry(w + 1.2, 0.25, 0.15), concMat, cx, 8.4, cz - d / 2 - 0.55, 80, 'wall');
    addPart(new THREE.BoxGeometry(0.15, 0.25, d + 1.2), concMat, cx + w / 2 + 0.55, 8.4, cz, 80, 'wall');
    addPart(new THREE.BoxGeometry(0.15, 0.25, d + 1.2), concMat, cx - w / 2 - 0.55, 8.4, cz, 80, 'wall');
    // Balcony (2nd floor, front)
    addPart(new THREE.BoxGeometry(w + 2, 0.15, 1.5), concMat, cx, fh + 0.08, cz + d / 2 + 1, 80, 'floor');
    // Balcony railing posts
    for (let i = -2; i <= 2; i++) {
        addPart(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), railMat, cx + i * 1.2, fh + 0.55, cz + d / 2 + 1.6, 30, 'wall');
    }
    // Balcony railing bar
    addPart(new THREE.BoxGeometry(w + 2, 0.06, 0.06), railMat, cx, fh + 1.05, cz + d / 2 + 1.6, 30, 'wall');
    // Door (ground floor)
    addDoor(cx, cz + d / 2, 1.4, 1.3, 2.8, 0.35, 80, 0);
    // === TOWER INTERIOR ===
    for (let f = 0; f < 2; f++) {
        const fy = f * fh;
        // Desk
        addPart(new THREE.BoxGeometry(2.0, 0.08, 1.0), floorMat2, cx - 1, fy + 0.85, cz - d / 2 + 1.2, 30, 'wall');
        [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]].forEach(([lx, lz]) => {
            addPart(new THREE.BoxGeometry(0.06, 0.85, 0.06), trimMat, cx - 1 + lx, fy + 0.42, cz - d / 2 + 1.2 + lz, 15, 'wall');
        });
        // Chair at desk
        addChair(cx - 1, cz - d / 2 + 2.2);
        // Filing cabinet
        addPart(new THREE.BoxGeometry(0.6, 1.2, 0.5), railMat, cx + w / 2 - 0.8, fy + 0.6, cz - d / 2 + 0.5, 40, 'wall');
        // Monitor on desk
        addPart(new THREE.BoxGeometry(0.5, 0.35, 0.05), tvMat, cx - 1.5, fy + 1.1, cz - d / 2 + 0.8, 10, 'wall');
        addPart(new THREE.BoxGeometry(0.4, 0.28, 0.03), tvScreenMat, cx - 1.5, fy + 1.12, cz - d / 2 + 0.78, 8, 'wall');
    }
    // Water cooler (ground floor)
    addPart(new THREE.BoxGeometry(0.35, 1.0, 0.35), new THREE.MeshStandardMaterial({ color: 0xbbdefb, transparent: true, opacity: 0.6 }), cx + w / 2 - 0.6, 0.8, cz + d / 2 - 1, 25, 'wall');
}

// === PARK ===
function buildPark(cx, cz) {
    // Foundation & Grass patch
    addPart(new THREE.BoxGeometry(12, 8, 12), floorMat2, cx, -3.9, cz, 60, 'floor');
    const parkGrass = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.95 }));
    parkGrass.rotation.x = -Math.PI / 2; parkGrass.position.set(cx, 0.1 + currentTerrainH, cz); parkGrass.receiveShadow = true; scene.add(parkGrass);
    // Benches
    [-1, 1].forEach(s => {
        // Bench seat
        addPart(new THREE.BoxGeometry(2.0, 0.08, 0.5), floorMat2, cx + s * 3, 0.5, cz, 30, 'wall');
        // Bench back
        addPart(new THREE.BoxGeometry(2.0, 0.4, 0.08), floorMat2, cx + s * 3, 0.8, cz + 0.21, 25, 'wall');
        // Bench legs
        [-0.8, 0.8].forEach(lx => {
            addPart(new THREE.BoxGeometry(0.06, 0.5, 0.06), railMat, cx + s * 3 + lx, 0.25, cz - 0.18, 15, 'wall');
            addPart(new THREE.BoxGeometry(0.06, 0.5, 0.06), railMat, cx + s * 3 + lx, 0.25, cz + 0.18, 15, 'wall');
        });
    });
    // Fountain center
    addPart(new THREE.CylinderGeometry(1.5, 1.8, 0.6, 16), concMat, cx, 0.3, cz, 80, 'wall');
    const waterFount = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.6, roughness: 0.05 }));
    waterFount.position.set(cx, 0.5, cz); scene.add(waterFount);
    addPart(new THREE.CylinderGeometry(0.1, 0.15, 1.2, 8), concMat, cx, 1.0, cz, 40, 'wall');
    // Trees around park
    addTree(cx - 5, cz - 5, 1.3); addTree(cx + 5, cz - 5, 1.5); addTree(cx - 5, cz + 5, 1.4); addTree(cx + 5, cz + 5, 1.2);
}

// === BUS STOP ===
function addBusStop(cx, cz) {
    // Shelter roof
    addPart(new THREE.BoxGeometry(3, 0.1, 1.5), concMat, cx, 2.8, cz, 50, 'floor');
    // Back panel
    addPart(new THREE.BoxGeometry(3, 2.8, 0.08), glassMat, cx, 1.4, cz + 0.7, 30, 'wall');
    // Side panels
    [-1, 1].forEach(s => {
        addPart(new THREE.BoxGeometry(0.08, 2.8, 1.5), glassMat, cx + s * 1.46, 1.4, cz, 30, 'wall');
    });
    // Support poles
    [-1, 1].forEach(s => {
        addPart(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), railMat, cx + s * 1.4, 1.4, cz - 0.65, 40, 'wall');
    });
    // Bench inside
    addPart(new THREE.BoxGeometry(2.4, 0.06, 0.4), floorMat2, cx, 0.55, cz + 0.3, 20, 'wall');
    addPart(new THREE.BoxGeometry(0.06, 0.55, 0.06), railMat, cx - 1.1, 0.27, cz + 0.3, 15, 'wall');
    addPart(new THREE.BoxGeometry(0.06, 0.55, 0.06), railMat, cx + 1.1, 0.27, cz + 0.3, 15, 'wall');
}

// --- SHED (with support beams and workbench) ---
function buildShed(cx, cz) {
    currentTerrainH = getTerrainH(cx, cz);
    chestSpawns.push({ x: cx, z: cz - 2 });
    const w = 8, h = 3.5, d = 8;
    // 3 walls (open front)
    addPart(new THREE.BoxGeometry(w, h, 0.2), wallMat, cx, h / 2, cz - d / 2, 60, 'wall');
    addPart(new THREE.BoxGeometry(0.2, h, d), wallMat, cx - w / 2, h / 2, cz, 60, 'wall');
    addPart(new THREE.BoxGeometry(0.2, h, d), wallMat, cx + w / 2, h / 2, cz, 60, 'wall');
    // Foundation
    addPart(new THREE.BoxGeometry(w, 8, d), floorMat2, cx, -3.9, cz, 60, 'floor');
    // Roof (sloped - thicker at back, thinner at front)
    addPart(new THREE.BoxGeometry(w + 0.5, 0.2, d + 0.5), roofMat, cx, h + 0.1, cz, 80, 'floor');
    // Support beams (diagonal)
    [-1, 1].forEach(s => {
        addPartR(new THREE.BoxGeometry(0.1, 0.1, 2.8), trimMat, cx + s * (w / 2 - 0.2), h - 1.2, cz + 0.8, 0.6, 0, 0, 40, 'wall');
    });
    // Corner posts (Logs)
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 8), trimMat.clone());
        post.position.set(cx + sx * w / 2, h / 2, cz + sz * d / 2); post.castShadow = true; post.receiveShadow = true;
        post.userData = { type: 'wall', hp: 50 }; scene.add(post); builds.push(post);
    });
    // Front posts (open side)
    [-1, 1].forEach(s => {
        addPart(new THREE.CylinderGeometry(0.08, 0.08, h, 8), trimMat, cx + s * (w / 2 - 0.1), h / 2, cz + d / 2, 50, 'wall');
    });
    // Workbench inside
    addPart(new THREE.BoxGeometry(w - 1, 0.1, 1.2), floorMat2, cx, 1.0, cz - d / 2 + 1, 40, 'floor');
    // Workbench legs
    [-1, 1].forEach(s => {
        addPart(new THREE.BoxGeometry(0.1, 1.0, 0.1), trimMat, cx + s * (w / 2 - 1), 0.5, cz - d / 2 + 0.6, 30, 'wall');
        addPart(new THREE.BoxGeometry(0.1, 1.0, 0.1), trimMat, cx + s * (w / 2 - 1), 0.5, cz - d / 2 + 1.4, 30, 'wall');
    });
    // Shelf on back wall
    addPart(new THREE.BoxGeometry(w - 0.8, 0.08, 0.6), floorMat2, cx, 2.2, cz - d / 2 + 0.35, 30, 'floor');
}

// === SHOP (open front, shelves inside, you can walk in) ===
function buildShop(cx, cz, color) {
    currentTerrainH = getTerrainH(cx, cz);
    chestSpawns.push({ x: cx, z: cz });
    const w = 10, h = 4, d = 8;
    const shopMat = new THREE.MeshStandardMaterial({ color: color || 0xb0bec5, roughness: 0.6 });
    // Back wall
    addPart(new THREE.BoxGeometry(w, h, 0.3), shopMat, cx, h / 2, cz - d / 2, 100, 'wall');
    // Side walls
    addPart(new THREE.BoxGeometry(0.3, h, d), shopMat, cx - w / 2, h / 2, cz, 100, 'wall');
    addPart(new THREE.BoxGeometry(0.3, h, d), shopMat, cx + w / 2, h / 2, cz, 100, 'wall');
    // Foundation & Floor
    addPart(new THREE.BoxGeometry(w, 8, d), floorMat2, cx, -3.9, cz, 100, 'floor');
    addPart(new THREE.BoxGeometry(w, 0.2, d), floorMat2, cx, 0.1, cz, 100, 'floor');
    // NO front wall — open entrance!
    // Floor
    addPart(new THREE.BoxGeometry(w, 0.15, d), floorMat2, cx, 0.08, cz, 120, 'floor');
    // Roof
    addPart(new THREE.BoxGeometry(w + 1, 0.25, d + 1), concMat, cx, h + 0.13, cz, 100, 'floor');
    // Awning over entrance
    addPartR(new THREE.BoxGeometry(w + 1.5, 0.1, 2.5), new THREE.MeshStandardMaterial({ color: color || 0xd32f2f, roughness: 0.6 }), cx, h - 0.5, cz + d / 2 + 1.2, -0.15, 0, 0, 60, 'floor');
    // Shelves inside (3 along back wall)
    for (let i = -1; i <= 1; i++) {
        addPart(new THREE.BoxGeometry(2.5, 0.1, 0.8), floorMat2, cx + i * 3, 1.2, cz - d / 2 + 1, 30, 'floor');
        addPart(new THREE.BoxGeometry(2.5, 0.1, 0.8), floorMat2, cx + i * 3, 2.2, cz - d / 2 + 1, 30, 'floor');
        // Shelf legs
        addPart(new THREE.BoxGeometry(0.1, 2.2, 0.1), trimMat, cx + i * 3 - 1.2, 1.1, cz - d / 2 + 0.6, 30, 'wall');
        addPart(new THREE.BoxGeometry(0.1, 2.2, 0.1), trimMat, cx + i * 3 + 1.2, 1.1, cz - d / 2 + 0.6, 30, 'wall');
    }
    // Counter near front
    addPart(new THREE.BoxGeometry(w - 2, 1.0, 0.8), wallMat, cx, 0.5, cz + d / 2 - 2, 60, 'wall');
    // Sign above entrance
    addPart(new THREE.BoxGeometry(4, 0.8, 0.1), new THREE.MeshStandardMaterial({ color: 0xfdd835 }), cx, h + 0.6, cz + d / 2 + 0.1, 40, 'wall');
    // === SHOP INTERIOR ===
    // Cash register on counter
    addPart(new THREE.BoxGeometry(0.4, 0.3, 0.3), tvMat, cx + 1, 1.15, cz + d / 2 - 2, 15, 'wall');
    addPart(new THREE.BoxGeometry(0.3, 0.25, 0.05), tvScreenMat, cx + 1, 1.25, cz + d / 2 - 2.15, 10, 'wall');
    // Product boxes on shelves
    const boxColors = [0xc62828, 0x1565c0, 0x2e7d32, 0xf57f17, 0x6a1b9a];
    for (let i = -1; i <= 1; i++) {
        for (let b = 0; b < 3; b++) {
            addPart(new THREE.BoxGeometry(0.4, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: boxColors[(i + b + 3) % 5] }), cx + i * 3 - 0.6 + b * 0.6, 1.35, cz - d / 2 + 1, 5, 'wall');
            addPart(new THREE.BoxGeometry(0.4, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: boxColors[(i + b + 1) % 5] }), cx + i * 3 - 0.6 + b * 0.6, 2.35, cz - d / 2 + 1, 5, 'wall');
        }
    }
    // Fridge in back corner
    addPart(new THREE.BoxGeometry(1.0, 2.0, 0.7), fridgeMat, cx + w / 2 - 1, 1.0, cz - d / 2 + 0.5, 60, 'wall');
    // Display table center
    addTable(cx, cz - 1);
}

// === WALKABLE HOUSE (door opening you can enter) ===
function buildOpenHouse(cx, cz) {
    currentTerrainH = getTerrainH(cx, cz);
    chestSpawns.push({ x: cx, z: cz });
    const w = 8, h = 4, d = 8;
    // Back wall
    addPart(new THREE.BoxGeometry(w, h, 0.3), wallMat, cx, h / 2, cz - d / 2, 80, 'wall');
    // Side walls
    addPart(new THREE.BoxGeometry(0.3, h, d), wallMat, cx - w / 2, h / 2, cz, 80, 'wall');
    addPart(new THREE.BoxGeometry(0.3, h, d), wallMat, cx + w / 2, h / 2, cz, 80, 'wall');
    // Front wall LEFT of door
    addPart(new THREE.BoxGeometry(w / 2 - 1, h, 0.3), wallMat, cx - w / 4 - 0.5, h / 2, cz + d / 2, 80, 'wall');
    // Front wall RIGHT of door
    addPart(new THREE.BoxGeometry(w / 2 - 1, h, 0.3), wallMat, cx + w / 4 + 0.5, h / 2, cz + d / 2, 80, 'wall');
    // Top bar over door
    addPart(new THREE.BoxGeometry(2.1, 1.2, 0.35), wallMat, cx, 3.4, cz + d / 2, 40, 'wall');
    // Door
    addDoor(cx, cz + d / 2, 1.4, 2.0, 0.15, 0.35, 50, 0);
    // Above door
    addPart(new THREE.BoxGeometry(2, h - 2.8, 0.3), wallMat, cx, h - 0.6, cz + d / 2, 80, 'wall');
    // Floor
    addPart(new THREE.BoxGeometry(w, 0.15, d), floorMat2, cx, 0.08, cz, 120, 'floor');
    // Roof
    addPart(new THREE.BoxGeometry(w + 1, 0.3, d + 1), roofMat, cx, h + 0.15, cz, 100, 'floor');
    // Roof ridge
    addPartR(new THREE.CylinderGeometry(0, 1.0, d + 1, 4), roofMat, cx, h + 0.7, cz, 0, Math.PI / 4, 0, 80, 'wall');
    // Door frame
    addPart(new THREE.BoxGeometry(2.1, 0.15, 0.35), doorMat, cx, 2.85, cz + d / 2, 40, 'wall');
    // Windows on sides
    [-1, 1].forEach(s => {
        addPart(new THREE.BoxGeometry(0.1, 1.3, 1.8), glassMat, cx + s * w / 2 + s * 0.1, h / 2 + 0.3, cz, 30, 'wall');
    });
    // Chimney
    addPart(new THREE.BoxGeometry(0.7, 1.8, 0.7), chimMat, cx + w / 2 - 1.5, h + 1, cz - d / 2 + 1, 60, 'wall');
    // === INTERIOR FURNITURE ===
    addSofa(cx - 1.5, cz + 1.5);
    addTable(cx + 1.5, cz - 0.5);
    addChair(cx + 0.8, cz + 0.3);
    addChair(cx + 2.2, cz + 0.3);
    addBookshelf(cx - 3.8, cz - 1.5);
    // Kitchen counter against back wall
    addPart(new THREE.BoxGeometry(3.0, 0.9, 0.6), concMat, cx + 2.5, 0.45, cz - d / 2 + 0.5, 40, 'wall');
    // Fridge
    addPart(new THREE.BoxGeometry(0.8, 1.8, 0.6), fridgeMat, cx - 3.8, 0.9, cz - d / 2 + 0.5, 50, 'wall');
    // TV on wall
    addPart(new THREE.BoxGeometry(1.2, 0.7, 0.06), tvMat, cx - 2, 2.2, cz - d / 2 + 0.2, 20, 'wall');
    addPart(new THREE.BoxGeometry(1.0, 0.55, 0.03), tvScreenMat, cx - 2, 2.2, cz - d / 2 + 0.17, 15, 'wall');
    // Rug
    addPart(new THREE.BoxGeometry(2.5, 0.02, 1.5), rugMat, cx, 0.22, cz, 10, 'floor');
}

// === CAR ===
function addCar(cx, cz, rot, color) {
    const carMat = new THREE.MeshStandardMaterial({ color: color || 0x1565c0, roughness: 0.4, metalness: 0.3 });
    const g = new THREE.Group();
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 4.5), carMat);
    body.position.y = 0.6; body.castShadow = true; g.add(body);
    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 2.2), carMat);
    cabin.position.set(0, 1.15, -0.3); cabin.castShadow = true; g.add(cabin);
    // Windshield
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.08), glassMat);
    ws.position.set(0, 1.1, 0.8); ws.rotation.x = 0.2; g.add(ws);
    // Rear window
    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), glassMat);
    rw.position.set(0, 1.1, -1.3); rw.rotation.x = -0.2; g.add(rw);
    // Side windows
    [-1, 1].forEach(s => {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 1.8), glassMat);
        sw.position.set(s * 1.0, 1.1, -0.3); g.add(sw);
    });
    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    [[-0.9, -1.5], [0.9, -1.5], [-0.9, 1.3], [0.9, 1.3]].forEach(([wx, wz]) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12), wheelMat);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.35, wz); wheel.castShadow = true; g.add(wheel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7 }));
        hub.rotation.z = Math.PI / 2; hub.position.set(wx, 0.35, wz); g.add(hub);
    });
    // Headlights
    [-0.7, 0.7].forEach(hx => {
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshStandardMaterial({ color: 0xfff9c4, emissive: 0xfff176, emissiveIntensity: 0.3 }));
        hl.position.set(hx, 0.6, 2.25); g.add(hl);
    });
    // Tail lights
    [-0.7, 0.7].forEach(hx => {
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0xd32f2f, emissive: 0xd32f2f, emissiveIntensity: 0.2 }));
        tl.position.set(hx, 0.6, -2.25); g.add(tl);
    });
    g.position.set(cx, getTerrainH(cx, cz), cz);
    g.rotation.y = rot || 0;
    scene.add(g);

    // Make parts collidable by adding them to builds array
    body.userData = { type: 'wall', hp: 300 };
    cabin.userData = { type: 'wall', hp: 200 };

    // We need to update world matrix to get correct positions for AABB collision
    g.updateMatrixWorld();
    builds.push(body);
    builds.push(cabin);
}

// === TERRAIN-CONFORMING ROAD ===
function addRoad(startX, startZ, w, d) {
    const isNS = d > w;
    const len = isNS ? d : w;
    const segments = Math.floor(len / 4);

    const geo = new THREE.PlaneGeometry(w, d, isNS ? 1 : segments, isNS ? segments : 1);

    // Load road texture
    const tex = loadTex('road_texture.png', isNS ? 1 : len / 8, isNS ? len / 8 : 1);
    const roadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, color: 0x999999 });

    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i) + startX;
        const vz = pos.getZ(i) + startZ;

        const h = getTerrainH(vx, vz) + 0.08; // slightly above terrain to prevent Z-fighting
        pos.setY(i, h);
    }

    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.position.set(startX, 0, startZ);
    mesh.receiveShadow = true;
    scene.add(mesh);
}

// === POWER POLE ===
function addPowerPole(x, z) {
    const poleMat = makeBarkMat(0.9, 1, 3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 12), poleMat);
    pole.position.set(x, 4, z); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.12), poleMat);
    arm.position.set(x, 7.5, z); scene.add(arm);
    // Insulators
    [-1, 0, 1].forEach(s => {
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x90a4ae }));
        ins.position.set(x + s * 1.2, 7.7, z); scene.add(ins);
    });
}

// Props
function addCrate(x, z) {
    currentTerrainH = getTerrainH(x, z);
    addPart(new THREE.BoxGeometry(1.5, 1.5, 1.5), crateMat, x, 0.75, z, 40, 'wall');
}
function addBarrel(x, z) {
    const th = getTerrainH(x, z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12), barrelMat.clone());
    m.position.set(x, 0.6 + th, z); m.castShadow = true; m.receiveShadow = true;
    m.userData = { type: 'wall', hp: 30 }; scene.add(m); builds.push(m);
}
function addRock(x, z, s) {
    const th = getTerrainH(x, z);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat.clone());
    m.position.set(x, s * 0.5 + th, z); m.rotation.set(Math.random(), Math.random(), 0);
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { type: 'wall', hp: 60 }; scene.add(m); builds.push(m);
}
function addTree(x, z, scale) {
    const th = getTerrainH(x, z);
    const s = scale || 1;
    const trunkMat = makeBarkMat(0.9, 1, 2);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.2 * s, 2 * s, 12), trunkMat);
    trunk.position.set(x, s + th, z); trunk.castShadow = true; scene.add(trunk);
    for (let i = 0; i < 3; i++) {
        const r = (1.4 - i * 0.3) * s, h = (1.2 - i * 0.15) * s;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), leafMat);
        leaf.position.set(x, 2 * s + i * 0.6 * s + th, z); leaf.castShadow = true; scene.add(leaf);
    }
}
function addLamp(x, z) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x424242, roughness: 0.3, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 8), poleMat);
    pole.position.set(x, 2, z); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), poleMat);
    arm.position.set(x + 0.3, 4, z); scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfff9c4, emissive: 0xfff176, emissiveIntensity: 0.6 }));
    bulb.position.set(x + 0.7, 3.9, z); scene.add(bulb);
    const lt = new THREE.PointLight(0xfff176, 0.5, 12);
    lt.position.set(x + 0.7, 3.8, z); scene.add(lt);
}


// ======= PLACE EVERYTHING =======
// Roads
addRoad(0, 0, 8, 380);        // Main road N-S
addRoad(0, 0, 380, 8);        // Cross road E-W


// Houses & Shops (Core area)
buildOpenHouse(-24, -24);
buildOpenHouse(32, 32);
buildOpenHouse(-32, 32);
buildOpenHouse(48, -32);
buildHouse1(-56, -16);
buildHouse1(56, 16);
buildShop(-24, 16, 0xd32f2f);
buildShop(24, -24, 0x1565c0);
buildShop(48, 48, 0x2e7d32);

// Towers (Moved further from center)
buildTower(-24, -56);
buildTower(48, -16);

// Sheds
buildShed(-16, 56);
buildShed(48, -56);
buildShed(-56, -48);

// Parks (Corners)
buildPark(65, -60);
buildPark(-65, 60);

// Bus stops (along roads, moved back slightly)
addBusStop(7, -35);
addBusStop(-7, 45);
addBusStop(45, 7);

// Extra buildings (center area)
buildOpenHouse(-60, 45);
buildHouse1(70, -35);

// === EXPANDED MAP — NEW DISTRICTS ===
// North District (z = -80 to -160)
buildOpenHouse(-80, -96);
buildOpenHouse(-56, -120);
buildHouse1(-24, -96);
buildHouse1(24, -120);
buildShop(56, -96, 0x9c27b0);
buildTower(80, -120);
buildShed(-88, -140);
buildPark(0, -120);
addRoad(0, -120, 160, 8);
addBusStop(8, -100);

// South District (z = 80 to 160)
buildOpenHouse(80, 96);
buildOpenHouse(48, 120);
buildHouse1(-24, 96);
buildHouse1(-56, 120);
buildShop(-80, 96, 0xff6f00);
buildTower(-48, 140);
buildShed(88, 120);
buildPark(0, 136);
addRoad(0, 120, 160, 8);
addBusStop(-8, 110);

// East District (x = 80 to 160)
buildOpenHouse(120, -24);
buildHouse1(120, 24);
buildShop(96, -56, 0x00897b);
buildTower(140, 48);
buildShed(100, 60);
addRoad(120, 0, 8, 160);

// West District (x = -80 to -160)
buildOpenHouse(-120, 24);
buildHouse1(-120, -24);
buildShop(-96, 56, 0x5d4037);
buildTower(-140, -48);
buildShed(-100, -60);
addRoad(-120, 0, 8, 160);

// Mountain Settlement 1 — NW peak (near -120, -120)
buildHouse1(-110, -100);
buildShed(-130, -110);
addCrate(-115, -108); addCrate(-125, -115);
addRock(-105, -115, 2.5); addRock(-135, -125, 3);

// Mountain Settlement 2 — SE peak (near 130, 110)
buildOpenHouse(120, 100);
buildShop(140, 95, 0x546e7a);
addCrate(125, 105); addCrate(135, 110);
addRock(145, 100, 2.8); addRock(115, 115, 2.2);

// Mountain Settlement 3 — NE peak (near 100, -130)
buildShed(95, -125);
buildHouse1(110, -135);
addCrate(100, -130); addRock(105, -140, 2.5);

// Cars (Parked on shoulders — original + new)
addCar(-7, -20, 0, 0x1565c0);
addCar(7, 20, Math.PI, 0xd32f2f);
addCar(-7, 35, 0, 0x424242);
addCar(7, -50, Math.PI, 0xffffff);
addCar(25, 7, Math.PI / 2, 0xffab00);
addCar(-35, -7, -Math.PI / 2, 0x2e7d32);
addCar(-7, -90, 0, 0x880e4f);
addCar(7, 90, Math.PI, 0x00695c);
addCar(90, 7, Math.PI / 2, 0x1a237e);
addCar(-90, -7, -Math.PI / 2, 0x4a148c);
addCar(125, -7, -Math.PI / 2, 0xff5722);
addCar(-125, 7, Math.PI / 2, 0x3e2723);

// Power poles (extended along roads)
addPowerPole(-6, -30); addPowerPole(-6, -60); addPowerPole(-6, 15);
addPowerPole(-6, 40); addPowerPole(-6, 65);
addPowerPole(-35, -6); addPowerPole(35, -6); addPowerPole(65, -6);
addPowerPole(-6, -90); addPowerPole(-6, -130); addPowerPole(-6, -160);
addPowerPole(-6, 90); addPowerPole(-6, 130); addPowerPole(-6, 160);
addPowerPole(90, -6); addPowerPole(130, -6); addPowerPole(160, -6);
addPowerPole(-90, -6); addPowerPole(-130, -6); addPowerPole(-160, -6);

// Lamp posts (extended)
addLamp(-12, -25); addLamp(12, 12); addLamp(-8, 35); addLamp(35, -25);
addLamp(-45, 10); addLamp(45, -10); addLamp(10, 55); addLamp(-10, -55);
addLamp(-80, -90); addLamp(80, 90); addLamp(-60, 100); addLamp(60, -100);
addLamp(120, 20); addLamp(-120, -20); addLamp(20, 120); addLamp(-20, -120);

// Trees — Massive Forest
for (let i = 0; i < 150; i++) {
    const rx = (Math.random() - 0.5) * 700;
    const rz = (Math.random() - 0.5) * 700;
    if (Math.abs(rx) < 60 && Math.abs(rz) < 60) continue; // Keep center pyramid area clear
    addTree(rx, rz, 4 + Math.random() * 8); // Scale between 4 and 12 for very large trees
}

// Rocks (extended)
addRock(-15, -15, 1.8); addRock(25, -35, 2.2); addRock(-28, 25, 1.5); addRock(38, 15, 2);
addRock(15, 35, 1.3); addRock(-42, -35, 1.7); addRock(48, -25, 1.9);
addRock(-68, -58, 2.0); addRock(68, 58, 1.6); addRock(-52, -65, 1.3);
addRock(-100, -40, 2.5); addRock(100, 40, 2.3); addRock(-80, 100, 1.8);
addRock(80, -100, 2.0); addRock(-130, 80, 2.8); addRock(130, -80, 2.6);
addRock(-160, -100, 3.0); addRock(160, 100, 2.8); addRock(-50, 140, 2.2);
addRock(50, -140, 2.4); addRock(140, 60, 2.0); addRock(-140, -60, 2.2);

// Crates & Barrels (extended)
addCrate(10, -10); addCrate(-12, -30); addCrate(18, 12); addCrate(-25, 25);
addCrate(-35, -20); addCrate(30, 20); addCrate(8, -40);
addCrate(45, 35); addCrate(-45, 45);
addCrate(80, -80); addCrate(-80, 80); addCrate(100, -50); addCrate(-100, 50);
addCrate(130, 30); addCrate(-130, -30); addCrate(60, 120); addCrate(-60, -120);
addBarrel(8, 18); addBarrel(-10, 8); addBarrel(28, -22); addBarrel(-32, -8);
addBarrel(15, -18); addBarrel(-20, 30); addBarrel(50, 8); addBarrel(-50, -12);
addBarrel(85, 70); addBarrel(-85, -70); addBarrel(110, -40); addBarrel(-110, 40);


// === MAP BORDERS (WATER) ===
const waterTex = loadTex('water_texture.png', 20, 20);

const waterMat = new THREE.MeshStandardMaterial({
    map: waterTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    roughness: 0.1,
    metalness: 0.3,
    side: THREE.DoubleSide
});

const WATER_Y = -0.8;
const waterPlanes = [];
// 4 water planes around the island
[{ x: 0, z: -450, w: 1000, d: 500 }, { x: 0, z: 450, w: 1000, d: 500 }, { x: -450, z: 0, w: 500, d: 1000 }, { x: 450, z: 0, w: 500, d: 1000 }].forEach(w => {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.d), waterMat);
    wm.rotation.x = -Math.PI / 2; wm.position.set(w.x, WATER_Y, w.z); wm.receiveShadow = true; scene.add(wm);
    waterPlanes.push(wm);
});
// Water under the island edges
const waterBelow = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), waterMat);
waterBelow.rotation.x = -Math.PI / 2; waterBelow.position.set(0, WATER_Y - 0.01, 0); waterBelow.receiveShadow = true; scene.add(waterBelow);
waterPlanes.push(waterBelow);

// Player death/respawn
function playerDie(cause) {
    pHP = 0; pShield = 0;
    updHUD();
    const kf = document.getElementById('killF');
    kf.textContent = cause || '¡ELIMINADO!';
    kf.classList.add('show');
    setTimeout(() => kf.classList.remove('show'), 3000);

    setTimeout(() => {
        document.getElementById('hud').classList.remove('active');
        document.getElementById('startScreen').style.display = 'flex';
        document.exitPointerLock();
        gamePhase = 'menu';
    }, 2000);
}

// Battle bus removed
function spawnChest(x, z) {
    const yFloor = groundH({ x: x, y: getTerrainH(x, z) + 20, z: z });
    const g = new THREE.Group();
    // Blue and silver chest
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x00bfff, roughness: 0.4, metalness: 0.3, emissive: 0x0088cc, emissiveIntensity: 0.2 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.2, metalness: 0.9 });
    const cb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), baseMat); cb.position.y = 0.4; g.add(cb);
    const cbTrim = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.85), trimMat); cbTrim.position.y = 0.4; g.add(cbTrim);
    const cbTrim2 = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.85, 0.1), trimMat); cbTrim2.position.y = 0.4; g.add(cbTrim2);

    // Rounded lid with pivot
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 0.8, -0.4); // hinge at back
    const lidGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 16, 1, false, 0, Math.PI);
    const lid = new THREE.Mesh(lidGeo, baseMat); lid.rotation.z = Math.PI / 2; lid.position.set(0, 0, 0.4); lidGroup.add(lid);
    const lidTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.22, 16, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.2, metalness: 0.9, wireframe: true }));
    lidTrim.rotation.z = Math.PI / 2; lidTrim.position.set(0, 0, 0.4); lidGroup.add(lidTrim);

    // Lock attached to lid
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8), trimMat);
    lock.rotation.x = Math.PI / 2; lock.position.set(0, 0, 0.85); lidGroup.add(lock);
    g.add(lidGroup);

    g.position.set(x, yFloor, z); g.userData = { type: 'chest', opened: false, lid: lidGroup, mat: baseMat }; scene.add(g); chests.push(g);
}
function openChest(ch) {
    if (ch.userData.opened) return;
    ch.userData.opened = true;
    if (ch.userData.mat) ch.userData.mat.emissiveIntensity = 0;
    if (ch.userData.lid) ch.userData.lid.rotation.x = -Math.PI / 2; // visually open lid
    for (let i = 0; i < 2; i++) {
        const lt = LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)];
        spawnLootItem(ch.position.x + (i - 0.5) * 1.5, ch.position.z + 1.2, lt);
    }
}
function spawnLootItem(x, z, lt) {
    const yFloor = groundH({ x: x, y: getTerrainH(x, z) + 20, z: z });
    const m = new THREE.Group();
    if (lt.type === 'shield' || (lt.type === 'weapon' && lt.wpnIdx === 2)) {
        // Shield model
        const shieldMat = new THREE.MeshStandardMaterial({ color: 0x42a5f5, metalness: 0.5, roughness: 0.5 });
        const shieldTrim = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), shieldMat);
        body.rotation.x = Math.PI / 2; m.add(body);
        const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16), shieldTrim);
        trim.rotation.x = Math.PI / 2; m.add(trim);
    } else if (lt.type === 'weapon' && lt.wpnIdx === 1) {
        // Sword model
        const bMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.1 });
        const hMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
        const gMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1 });
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), hMat);
        m.add(handle);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.05), gMat);
        guard.position.y = 0.1; m.add(guard);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.01), bMat);
        blade.position.y = 0.35; m.add(blade);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.1, 4), bMat);
        tip.position.y = 0.6; tip.rotation.y = Math.PI/4; m.add(tip);
        m.rotation.x = Math.PI / 4;
    } else if (lt.type === 'shield') {
        const itemMat = new THREE.MeshStandardMaterial({ color: lt.color, metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.85 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 }); // Brown cork/cap
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.35, 16), itemMat);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 16), capMat);
        cap.position.y = 0.2;
        body.add(cap);
        m.add(body);
    } else if (lt.type === 'heal') {
        const item = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.25), new THREE.MeshStandardMaterial({ color: lt.color, emissive: lt.color, emissiveIntensity: 0.1 }));
        m.add(item);
    } else {
        const item = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: lt.color, emissive: lt.color, emissiveIntensity: 0.3 }));
        m.add(item);
    }
    m.position.set(x, yFloor + 0.5, z); m.userData = { type: 'loot', loot: lt, bobPhase: Math.random() * Math.PI * 2, baseY: yFloor + 0.5 }; scene.add(m); lootItems.push(m);
}
function pickupLoot(item) {
    const lt = item.userData.loot;
    if (lt.type === 'weapon') {
        if (!pInv.includes(lt.wpnIdx)) pInv.push(lt.wpnIdx);
        WPN[lt.wpnIdx].mag = WPN[lt.wpnIdx].maxMag;
        mode = 'combat'; selW = lt.wpnIdx; mkFPW(selW);
    } else if (lt.type === 'heal' || lt.type === 'shield') {
        if (pConsumables.length < 2) {
            pConsumables.push(lt);
            mode = 'combat'; selW = 3 + pConsumables.length - 1; mkFPW(selW);
        } else {
            return; // Inventory full
        }
    }
    scene.remove(item);
    lootItems = lootItems.filter(l => l !== item);
    updHUD();
    const kf = document.getElementById('killF'); kf.textContent = '+ ' + lt.n; kf.classList.add('show'); setTimeout(() => kf.classList.remove('show'), 1200);
}
function spawnAllChests() {
    const radius = 8;
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const cx = Math.cos(angle) * radius;
        const cz = Math.sin(angle) * radius;
        spawnChest(cx, cz);
    }
}
function startBattleRoyale() {
    gamePhase = 'dropping'; kills = 0; botsAlive = totalBots - 1; pHP = 100; pShield = 0; res = 500;
    pInv = [0]; pConsumables = []; selW = 0; mkFPW(0);
    bots.forEach(b => scene.remove(b)); bots = [];
    chests.forEach(c => scene.remove(c)); chests = [];
    lootItems.forEach(l => scene.remove(l)); lootItems = [];
    spawnAllChests();

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('hud').classList.add('active');
    updHUD();

    const totalSpots = totalBots;
    const playerSpotIndex = Math.floor(Math.random() * totalSpots);
    const botRadius = 160;

    for (let i = 0; i < totalSpots; i++) { 
        const angle = (i / totalSpots) * Math.PI * 2;
        const px = Math.cos(angle) * botRadius;
        const pz = Math.sin(angle) * botRadius;
        
        if (i === playerSpotIndex) {
            cam.position.set(px, getTerrainH(px, pz) + 5, pz);
            cam.lookAt(0, cam.position.y, 0);
            vel.set(0, 0, 0);
        } else {
            spawnBot(px, pz);
        }
    }
    stormRadius = 400; stormTimer = 0; lastStormDmgT = Date.now();
    stormCenter = { x: (Math.random() - 0.5) * 150, z: (Math.random() - 0.5) * 150 };
    stormMesh.position.set(stormCenter.x, 100, stormCenter.z);
    stormMesh.scale.set(stormRadius, 1, stormRadius);
}


// === CACHED GEOMETRIES AND MATERIALS FOR SKINS ===
const _skinGeo = {
    torso: new THREE.BoxGeometry(0.5, 0.7, 0.3),
    head: new THREE.BoxGeometry(0.35, 0.35, 0.35),
    arm: new THREE.BoxGeometry(0.18, 0.6, 0.18),
    leg: new THREE.BoxGeometry(0.2, 0.6, 0.2),
    wreath: new THREE.TorusGeometry(0.2, 0.04, 8, 16),
    horn: new THREE.ConeGeometry(0.05, 0.3, 4),
    katana: new THREE.BoxGeometry(0.04, 0.8, 0.08)
};

const _skinMats = [
    // 0: LAVA
    {
        body: new THREE.MeshStandardMaterial({ color: 0x221111, roughness: 0.9 }),
        head: new THREE.MeshStandardMaterial({ color: 0x110000, roughness: 0.9 }),
        detail: new THREE.MeshStandardMaterial({ color: 0xff6d00, emissive: 0xff6d00, emissiveIntensity: 1 })
    },
    // 1: TECH
    {
        body: new THREE.MeshStandardMaterial({ color: 0x000033, roughness: 0.2, metalness: 0.8 }),
        head: new THREE.MeshStandardMaterial({ color: 0x000011, roughness: 0.2, metalness: 0.8 }),
        detail: new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1 })
    },
    // 2: GOLD
    {
        body: new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 1 }),
        head: new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.3, metalness: 1 }),
        detail: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 })
    },
    // 3: NINJA
    {
        body: new THREE.MeshStandardMaterial({ color: 0x1a0033, roughness: 0.8 }),
        head: new THREE.MeshStandardMaterial({ color: 0x311b92, roughness: 0.8 }),
        detail: new THREE.MeshStandardMaterial({ color: 0xd500f9, emissive: 0xd500f9, emissiveIntensity: 0.5 })
    },
    // 4: SAMURAI
    {
        body: new THREE.MeshStandardMaterial({ color: 0x003311, roughness: 0.6 }),
        head: new THREE.MeshStandardMaterial({ color: 0x001100, roughness: 0.6 }),
        detail: new THREE.MeshStandardMaterial({ color: 0x00e676, emissive: 0x00e676, emissiveIntensity: 1 })
    }
];

function mkSkin(id) {
    if (id === undefined) id = typeof window.selectedSkin !== 'undefined' ? window.selectedSkin : 0;
    if (id < 0 || id > 4) id = 0;
    const g = new THREE.Group();
    const mats = _skinMats[id];

    // Torso
    const torso = new THREE.Mesh(_skinGeo.torso, mats.body);
    torso.position.y = 0.9; torso.castShadow = true; g.add(torso);

    // Head
    const head = new THREE.Mesh(_skinGeo.head, mats.head);
    head.position.y = 1.45; head.castShadow = true; g.add(head);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.06, 0.04, 0.02);
    const eyeL = new THREE.Mesh(eyeGeo, mats.detail); eyeL.position.set(-0.08, 1.48, -0.18); g.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, mats.detail); eyeR.position.set(0.08, 1.48, -0.18); g.add(eyeR);

    // Arms
    const armL = new THREE.Mesh(_skinGeo.arm, mats.body); armL.position.set(-0.35, 0.9, 0); armL.castShadow = true; g.add(armL);
    const armR = new THREE.Mesh(_skinGeo.arm, mats.body); armR.position.set(0.35, 0.9, 0); armR.castShadow = true; g.add(armR);

    // Legs
    const legL = new THREE.Mesh(_skinGeo.leg, mats.body); legL.position.set(-0.15, 0.3, 0); legL.castShadow = true; g.add(legL);
    const legR = new THREE.Mesh(_skinGeo.leg, mats.body); legR.position.set(0.15, 0.3, 0); legR.castShadow = true; g.add(legR);

    // Unique details based on skin id
    if (id === 0) { // LAVA
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.32), mats.detail);
        crack.position.set(0, 0.8, 0); crack.rotation.z = 0.2; g.add(crack);
        const crack2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.32), mats.detail);
        crack2.position.set(0, 1.0, 0); crack2.rotation.z = -0.1; g.add(crack2);
    } else if (id === 1) { // TECH
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.32), mats.detail);
        line.position.set(-0.1, 0.9, 0); g.add(line);
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.02), mats.detail);
        core.position.set(0.1, 1.0, -0.16); g.add(core);
    } else if (id === 2) { // GOLD
        const wreath = new THREE.Mesh(_skinGeo.wreath, mats.body);
        wreath.rotation.x = Math.PI / 2; wreath.position.set(0, 1.6, 0); g.add(wreath);
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.35), mats.detail);
        belt.position.set(0, 0.6, 0); g.add(belt);
    } else if (id === 3) { // NINJA
        const mask = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.15, 0.36), mats.body);
        mask.position.set(0, 1.35, 0); g.add(mask);
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.35), mats.detail);
        belt.position.set(0, 0.6, 0); g.add(belt);
    } else if (id === 4) { // SAMURAI
        const hornL = new THREE.Mesh(_skinGeo.horn, mats.detail);
        hornL.position.set(-0.2, 1.6, 0); hornL.rotation.z = 0.5; g.add(hornL);
        const hornR = new THREE.Mesh(_skinGeo.horn, mats.detail);
        hornR.position.set(0.2, 1.6, 0); hornR.rotation.z = -0.5; g.add(hornR);
        const katana = new THREE.Mesh(_skinGeo.katana, new THREE.MeshStandardMaterial({ color: 0x333333 }));
        katana.position.set(0.3, 1.0, 0.2); katana.rotation.x = 0.5; katana.rotation.z = 0.5; g.add(katana);
    }

    // Weapon for bot (hidden for player, handled by FPW)
    // Gun removed, replaced by fists

    return g;
}

// Enemies (optimized but with detailed skins)
let bots = [];
function spawnBot(x, z) {
    const skinId = Math.floor(Math.random() * 5);
    const b = mkSkin(skinId);
    b.position.set(x, getTerrainH(x, z), z);
    b.userData = { hp: 100, shield: 100, dir: Math.random() > 0.5 ? 1 : -1, t: Math.random() * 2, maxHp: 100, target: null, lastFire: 0, hasWeapon: false };
    scene.add(b); bots.push(b);
}

// Bots spawned from battle bus - not here
let lastHitBot = null;
let eHP = 100;


// FP Weapon (detailed)
const fpG = new THREE.Group(); cam.add(fpG); scene.add(cam);
function mkFPW(t) {
    while (fpG.children.length) fpG.remove(fpG.children[0]);
    const g = new THREE.Group();
    
    if (t === 0) {
        // Puños (fists)
        const skinColor = new THREE.MeshStandardMaterial({ color: 0xffa07a, roughness: 0.8 });
        const fistGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
        const rightFist = new THREE.Mesh(fistGeo, skinColor);
        rightFist.position.set(0.15, -0.2, -0.4);
        g.add(rightFist);
        const leftFist = new THREE.Mesh(fistGeo, skinColor);
        leftFist.position.set(-0.15, -0.2, -0.4);
        g.add(leftFist);
    } else if (t === 1) {
        // Espada (sword) - ROBUST & SKINS
        const wSkinEl = document.querySelector('#wpnSkinSelector .selected');
        const wSkin = wSkinEl ? parseInt(wSkinEl.dataset.wskin) : 0;
        
        let bColor = 0xdddddd, bEmissive = 0x000000;
        let fColor = 0x111111, fEmissive = 0x000000;
        
        if (wSkin === 1) { // NEON
            bColor = 0x2a2a2a; fColor = 0x00e5ff; fEmissive = 0x0099cc;
        } else if (wSkin === 2) { // MAGMA
            bColor = 0x3a1a1a; bEmissive = 0x220000; fColor = 0xff5722; fEmissive = 0xdd2c00;
        }

        const bladeMat = new THREE.MeshStandardMaterial({ color: bColor, emissive: bEmissive, metalness: 1.0, roughness: 0.15 });
        const fullerMat = new THREE.MeshStandardMaterial({ color: fColor, emissive: fEmissive, metalness: 0.8, roughness: 0.2 });
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.95 });
        const guardMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.3 });

        // Handle
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 12), handleMat);
        handle.position.set(0.15, -0.25, -0.35);
        handle.rotation.x = Math.PI / 4;
        g.add(handle);

        // Pommel
        const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 16), guardMat);
        pommel.position.set(0.15, -0.31, -0.29);
        g.add(pommel);

        // Guard
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.04), guardMat);
        guard.position.set(0.15, -0.19, -0.41);
        guard.rotation.x = Math.PI / 4;
        g.add(guard);

        // Blade
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.01), bladeMat);
        blade.position.set(0.15, 0.09, -0.69); 
        blade.rotation.x = Math.PI / 4;
        g.add(blade);

        // Sharp Tip
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), bladeMat);
        tip.position.set(0.15, 0.3, -0.9);
        tip.rotation.set(Math.PI / 4, Math.PI / 4, 0, 'YXZ');
        g.add(tip);
        
        // Fuller
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.45, 0.012), fullerMat);
        fuller.position.set(0.15, 0.05, -0.65);
        fuller.rotation.x = Math.PI / 4;
        g.add(fuller);
    } else if (t === 2) {
        // Escudo (shield)
        const shieldMat = new THREE.MeshStandardMaterial({ color: 0x42a5f5, metalness: 0.4, roughness: 0.6 });
        const shieldTrim = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });

        const shieldBody = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), shieldMat);
        shieldBody.rotation.x = Math.PI / 2;
        shieldBody.position.set(0, -0.1, -0.5);
        g.add(shieldBody);

        const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16), shieldTrim);
        trim.rotation.x = Math.PI / 2;
        trim.position.set(0, -0.1, -0.5);
        g.add(trim);
    } else if (t >= 3) {
        const consIdx = t - 3;
        if (pConsumables[consIdx]) {
            const lt = pConsumables[consIdx];
            if (lt.type === 'shield') {
                const itemMat = new THREE.MeshStandardMaterial({ color: lt.color, metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.85 });
                const capMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
                const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 16), itemMat);
                const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.02, 16), capMat);
                cap.position.y = 0.085;
                body.add(cap);
                body.position.set(0.15, -0.1, -0.3);
                body.rotation.x = -Math.PI / 4;
                body.rotation.z = Math.PI / 8;
                g.add(body);
            } else {
                const consMat = new THREE.MeshStandardMaterial({ color: lt.color });
                const itemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.1), consMat);
                itemMesh.position.set(0.15, -0.1, -0.3);
                itemMesh.rotation.x = -Math.PI / 8;
                itemMesh.rotation.y = Math.PI / 6;
                g.add(itemMesh);
            }
        }
    }

    fpG.add(g);
}
mkFPW(0);

// Ghost preview
const ghMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
let ghost = null;
function ghGeo(t) {
    if (t === 0) return new THREE.BoxGeometry(G, G, 0.3); // Wall
    if (t === 1) { // Ramp
        const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(G, 0); sh.lineTo(G, G); sh.lineTo(0, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: G, bevelEnabled: false });
        geo.translate(-G / 2, 0, -G / 2); return geo;
    }
    if (t === 2) return new THREE.BoxGeometry(G, 0.3, G); // Floor
    if (t === 3) { // Window wall
        const sh = new THREE.Shape();
        sh.moveTo(-G / 2, 0); sh.lineTo(G / 2, 0); sh.lineTo(G / 2, G);
        sh.lineTo(-G / 2, G); sh.lineTo(-G / 2, 0);
        const hole = new THREE.Path();
        hole.moveTo(-G / 4, G * 0.3); hole.lineTo(G / 4, G * 0.3);
        hole.lineTo(G / 4, G * 0.7); hole.lineTo(-G / 4, G * 0.7);
        sh.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false });
        geo.translate(0, 0, -0.15); return geo;
    }
    if (t === 4) { // Door wall
        const sh = new THREE.Shape();
        sh.moveTo(-G / 2, 0); sh.lineTo(G / 2, 0); sh.lineTo(G / 2, G);
        sh.lineTo(-G / 2, G); sh.lineTo(-G / 2, 0);
        const hole = new THREE.Path();
        hole.moveTo(-G * 0.2, 0); hole.lineTo(G * 0.2, 0);
        hole.lineTo(G * 0.2, G * 0.65); hole.lineTo(-G * 0.2, G * 0.65);
        sh.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false });
        geo.translate(0, 0, -0.15); return geo;
    }
    return new THREE.BoxGeometry(G, 0.3, G);
}
function updGhost() {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (mode !== 'build') return;
    ghost = new THREE.Mesh(ghGeo(selB), ghMat); scene.add(ghost);
}

// === EDIT MODE ===
const editHighMat = new THREE.MeshStandardMaterial({ color: 0xfdd835, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

function enterEditMode() {
    mode = 'edit';
    deselectEdit();
    if (ghost) { scene.remove(ghost); ghost = null; }
    updHUD();
}
function exitEditMode() {
    deselectEdit();
    mode = 'combat';
    updHUD();
}
function deselectEdit() {
    if (editSel && editOrigColor !== null) {
        editSel.material.color.setHex(editOrigColor);
        editSel.material.opacity = 1;
        editSel.material.transparent = false;
    }
    editSel = null; editOrigColor = null; editMoving = false;
}
function selectBuild(obj) {
    deselectEdit();
    if (!obj || !obj.userData.playerBuilt) return;
    editSel = obj;
    editOrigColor = obj.material.color.getHex();
    obj.material.color.setHex(0xfdd835);
    obj.material.transparent = true;
    obj.material.opacity = 0.7;
}
function editRotate() {
    if (!editSel) return;
    editSel.rotation.y += Math.PI / 2;
    editSel.updateMatrixWorld();
    editSel.userData.bb = new THREE.Box3().setFromObject(editSel);
}
function editDelete() {
    if (!editSel) return;
    scene.remove(editSel);
    builds = builds.filter(x => x !== editSel);
    bCnt = Math.max(0, bCnt - 1);
    res += Math.floor(BCOST * 0.5); // refund half
    editSel = null; editOrigColor = null;
    updHUD();
}
function editStartMove() {
    if (!editSel) return;
    editMoving = true;
}
function editClick() {
    if (editMoving && editSel) {
        // Place at new position (snap to grid)
        const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        d.y = 0; d.normalize();
        const p = cam.position.clone().add(d.multiplyScalar(G * 1.5));
        const sn = new THREE.Vector3(Math.round(p.x / G) * G, Math.max(0, Math.round(p.y / G) * G), Math.round(p.z / G) * G);
        editSel.position.copy(sn);
        editSel.updateMatrixWorld();
        editSel.userData.bb = new THREE.Box3().setFromObject(editSel);
        editMoving = false;
        // Restore color
        editSel.material.color.setHex(editOrigColor);
        editSel.material.opacity = 1;
        editSel.material.transparent = false;
        editSel = null; editOrigColor = null;
        return;
    }
    // Raycast to find a player-built piece
    const rc2 = new THREE.Raycaster();
    rc2.setFromCamera(new THREE.Vector2(0, 0), cam);
    rc2.far = 30;
    const playerBuilds = builds.filter(b => b.userData.playerBuilt);
    const hits = rc2.intersectObjects(playerBuilds);
    if (hits.length > 0) {
        selectBuild(hits[0].object);
    } else {
        deselectEdit();
    }
}
function posEditGhost() {
    if (!editMoving || !editSel) return;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    d.y = 0; d.normalize();
    const p = cam.position.clone().add(d.multiplyScalar(G * 1.5));
    const sn = new THREE.Vector3(Math.round(p.x / G) * G, Math.max(0, Math.round(p.y / G) * G), Math.round(p.z / G) * G);
    editSel.position.copy(sn);
}
function posGhost() {
    if (!ghost) return;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    d.y = 0; d.normalize();
    const p = cam.position.clone().add(d.multiplyScalar(G * 1.5));
    const sn = new THREE.Vector3(Math.round(p.x / G) * G, Math.max(0, Math.round(p.y / G) * G), Math.round(p.z / G) * G);
    ghost.position.copy(sn);
    ghost.rotation.set(0, bRot * Math.PI / 2, 0);
    // Fix: walls sit ON the ground, not halfway in
    if ((selB === 0 || selB === 3 || selB === 4) && sn.y === 0) ghost.position.y = G / 2;
    if (selB === 2 && sn.y === 0) ghost.position.y = G;
}

// Place build
function placeBuild() {
    if (mode !== 'build' || res < BCOST || !ghost) return;
    const colors = [0x37474f, 0x37474f, 0x37474f, 0x546e7a, 0x4e342e];
    const mt = new THREE.MeshStandardMaterial({ color: colors[selB] || 0x37474f, roughness: 0.7, side: THREE.DoubleSide });
    const m = new THREE.Mesh(ghGeo(selB), mt);
    m.position.copy(ghost.position); m.rotation.copy(ghost.rotation);
    m.castShadow = true; m.receiveShadow = true;
    const types = ['wall', 'ramp', 'floor', 'wall', 'wall'];
    m.userData = { type: types[selB] || 'wall', hp: 100, playerBuilt: true };
    scene.add(m); builds.push(m); res -= BCOST; bCnt++; updHUD();
    // Add glass to window wall
    if (selB === 3) {
        const glass = new THREE.Mesh(
            new THREE.PlaneGeometry(G / 2, G * 0.4),
            new THREE.MeshStandardMaterial({ color: 0x80deea, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
        );
        glass.position.set(0, G * 0.5, 0);
        m.add(glass);
    }
}

// Shoot
const rc = new THREE.Raycaster();
function shoot() {
    if (mode !== 'combat' || gamePhase !== 'playing') return;
    
    if (selW >= 3) {
        const consIdx = selW - 3;
        if (pConsumables[consIdx]) {
            const cons = pConsumables[consIdx];
            if (cons.type === 'heal') pHP = Math.min(100, pHP + cons.amount);
            else if (cons.type === 'shield') pShield = Math.min(100, pShield + cons.amount);
            pConsumables.splice(consIdx, 1);
            selW = 0; mkFPW(0); updHUD();
        }
        return;
    }

    if (WPN[selW].reloading) return;
    if (WPN[selW].mag <= 0) { reloadWpn(); return; }

    const now = Date.now(); if (now - lastShot < WPN[selW].rate) return; lastShot = now;

    if (false) {
        WPN[selW].mag--;
        updHUD();
    }

    const pellets = selW === 1 ? 8 : 1;
    const spread = selW === 1 ? 0.12 : (selW === 0 ? 0.01 : 0);
    const dmgPerPellet = selW === 1 ? WPN[selW].dmg / pellets : WPN[selW].dmg;

    const targetMeshes = [];
    bots.forEach(b => {
        b.traverse(c => { if (c.isMesh) { c.userData.botId = b.uuid; targetMeshes.push(c); } });
    });
    let hitAny = false;

    for (let i = 0; i < pellets; i++) {
        const off = new THREE.Vector2(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread
        );
        rc.setFromCamera(off, cam); rc.far = WPN[selW].rng;

        const hits = rc.intersectObjects(targetMeshes);
        const bH = rc.intersectObjects(builds);

        let hitBot = null;
        let hitBuild = null;

        if (hits.length > 0 && bH.length > 0) {
            if (hits[0].distance < bH[0].distance) hitBot = hits[0];
            else hitBuild = bH[0];
        } else if (hits.length > 0) {
            hitBot = hits[0];
        } else if (bH.length > 0) {
            hitBuild = bH[0];
        }

        if (hitBot) {
            const bot = bots.find(b => b.uuid === hitBot.object.userData.botId);
            if (bot) {
                // Shield-first damage
                if (bot.userData.shield > 0) {
                    const sDmg = Math.min(bot.userData.shield, dmgPerPellet);
                    bot.userData.shield -= sDmg;
                    bot.userData.hp = Math.max(0, bot.userData.hp - (dmgPerPellet - sDmg));
                } else {
                    bot.userData.hp = Math.max(0, bot.userData.hp - dmgPerPellet);
                }
                showDamage(dmgPerPellet, hitBot.point);
                hitAny = true;
                if (bot.userData.hp <= 0) {
                    handleBotDeath(bot, 'player');
                } else {
                    bot.userData.target = 'player';
                }
            }
        } else if (hitBuild) {
            const dmg = selW === 2 ? WPN[2].dmg : dmgPerPellet * 0.5;
            hitBuild.object.userData.hp -= dmg;
            const targetObj = hitBuild.object;
            const origColor = targetObj.material.color.getHex();
            targetObj.material.color.setHex(0xff4444);
            setTimeout(() => { if (targetObj.material) targetObj.material.color.setHex(origColor); }, 100);
            if (targetObj.userData.hp <= 0) {
                scene.remove(targetObj); builds = builds.filter(x => x !== targetObj);
                if (selW === 2) res += 10;
                bCnt = Math.max(0, bCnt - 1);
            }
            hitAny = true;
        }

        // No tracers for fists
    }

    if (hitAny) { showHit(); updHUD(); }

    // No flash for fists
    if (fpG.children[0]) { fpG.children[0].position.z += 0.06; setTimeout(() => { if (fpG.children[0]) fpG.children[0].position.z -= 0.06; }, 80); }
}

function reloadWpn() {
    if (selW === 2 || WPN[selW].mag === WPN[selW].maxMag || WPN[selW].reloading) return;
    WPN[selW].reloading = true;
    updHUD();
    setTimeout(() => {
        WPN[selW].mag = WPN[selW].maxMag;
        WPN[selW].reloading = false;
        updHUD();
    }, WPN[selW].reloadTime);
}

function showDamage(dmg, pos) {
    const p = pos.clone();
    p.project(cam);
    if (p.z > 1) return; // behind camera
    const x = (p.x * 0.5 + 0.5) * innerWidth;
    const y = (p.y * -0.5 + 0.5) * innerHeight;

    const el = document.createElement('div');
    el.className = 'damage-number';
    el.textContent = '-' + Math.round(dmg);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.getElementById('hud').appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
}

function handleBotDeath(bot, killer) {
    if (killer === 'player') kills++;
    scene.remove(bot);
    bots = bots.filter(b => b !== bot);
    botsAlive--;
    // Drop loot from enemy
    const lt = LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)];
    spawnLootItem(bot.position.x, bot.position.z, lt);
    // Kill feed
    const feed = document.getElementById('killFeed');
    if (feed) {
        const e = document.createElement('div');
        e.className = 'kill-entry';
        e.textContent = (killer === 'player' ? 'TÚ ☠ ' : 'Bot ☠ ') + 'Bot #' + (50 - botsAlive);
        feed.prepend(e);
        if (feed.children.length > 5) feed.removeChild(feed.lastChild);
    }
    if (killer === 'player') showKill();
    updHUD();
}

function showHit() { const e = document.getElementById('hitM'); e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 150); }
function showKill() {
    const e = document.getElementById('killF'); e.textContent = '¡ELIMINADO!'; e.classList.add('show');
    setTimeout(() => { e.classList.remove('show'); updHUD(); }, 2000);
}

// HUD
function updHUD() {
    const pHpEl = document.getElementById('pHp');
    if (pHpEl) { pHpEl.style.width = pHP + '%'; document.getElementById('pHpT').textContent = Math.round(pHP) + ' | 100'; }
    const pShEl = document.getElementById('pShield');
    if (pShEl) { pShEl.style.width = pShield + '%'; document.getElementById('pShieldT').textContent = Math.round(pShield) + '|100'; }
    const ammoEl = document.getElementById('pAmmo');
    if (ammoEl) {
        if (selW === 2 || selW >= 3) ammoEl.textContent = 'AMMO: ∞';
        else if (WPN[selW].reloading) ammoEl.textContent = 'RELOADING...';
        else ammoEl.textContent = `AMMO: ${WPN[selW].mag} / ${WPN[selW].maxMag}`;
    }
    document.getElementById('pRes').textContent = 'RECURSOS: ' + res + ' | KILLS: ' + kills;
    const alive = document.getElementById('aliveNum');
    if (alive) alive.textContent = botsAlive;
    const mi = document.getElementById('modeI');
    if (mi) {
        if (mode === 'edit') { mi.className = 'mode-ind e'; mi.textContent = '✏ EDITAR'; }
        else if (mode === 'build') { mi.className = 'mode-ind b'; mi.textContent = '🔨 CONSTRUIR'; }
        else { mi.className = 'mode-ind c'; mi.textContent = '⚔ COMBATE'; }
    }
    const ei = document.getElementById('editInfo');
    if (ei) { ei.className = mode === 'edit' ? 'show' : ''; }
    
    const combatLb = [
        ['✊', '1'], ['⚔', '2'], ['🛡', '3'], 
        pConsumables.length > 0 ? [pConsumables[0].type === 'heal' ? '🩹' : '💧', '4'] : ['', '4'], 
        pConsumables.length > 1 ? [pConsumables[1].type === 'heal' ? '🩹' : '💧', '5'] : ['', '5']
    ];
    const buildLb = [['▬', '1'], ['◣', '2'], ['▭', '3'], ['⊞', '4'], ['⊟', '5']];
    const editLb = [['✎', '1'], ['↻', 'R'], ['✕', 'X'], ['↔', 'F'], ['', '5']];
    const lb = mode === 'combat' ? combatLb : (mode === 'build' ? buildLb : editLb);
    
    for (let i = 0; i < 5; i++) {
        const b = document.getElementById('s' + (i + 1));
        if (!b) continue;
        
        b.querySelector('.ic').textContent = lb[i] ? lb[i][0] : '';
        b.querySelector('.lb').textContent = lb[i] ? lb[i][1] : '';
        b.className = 'bbtn';
        b.style.opacity = '1';
        
        if (mode === 'combat') { 
            b.style.display = 'flex';
            if (i === selW) b.classList.add('con'); 
            
            if (i < 3 && !pInv.includes(i)) {
                b.querySelector('.ic').textContent = '';
                b.style.opacity = '0.3';
            } else if (i >= 3 && pConsumables.length <= (i - 3)) {
                b.querySelector('.ic').textContent = '';
                b.style.opacity = '0.3';
            }
        }
        else if (mode === 'build') { 
            b.style.display = 'flex';
            if (i === selB) b.classList.add('on'); 
        }
        else { 
            b.style.display = i < 4 ? 'flex' : 'none'; 
        }
    }
    document.querySelectorAll('#pW li').forEach((l, i) => l.classList.toggle('active', i === selW));

    // Update Crosshair
    const ch = document.getElementById('crosshair');
    if (ch) {
        ch.className = '';
        if (mode === 'combat') ch.classList.add('ch-' + (selW < 3 ? selW : 2));
        else ch.classList.add('ch-2'); // Use pickaxe style for build/edit
    }
}

// Input
document.addEventListener('keydown', e => {
    if (e.code === 'Space' && gamePhase === 'bus') {
        // Jump from bus
        gamePhase = 'dropping';
        cam.position.copy(busGroup.position);
        cam.position.y = busGroup.position.y - 5;
        vel.set(0, 0, 0);
        document.getElementById('busOverlay').classList.remove('active');
        return;
    }
    if (e.code === 'KeyF' && gamePhase === 'playing') {
        const rc2 = new THREE.Raycaster();
        rc2.setFromCamera(new THREE.Vector2(0, 0), cam); rc2.far = 8;

        // Check items first
        const lh = rc2.intersectObjects(lootItems, true);
        if (lh.length > 0) {
            let obj = lh[0].object;
            while (obj && !obj.userData.loot) obj = obj.parent;
            if (obj && obj.userData.loot) { pickupLoot(obj); return; }
        }

        // Check chests
        const chHit = rc2.intersectObjects(chests, true);
        if (chHit.length > 0) {
            let obj = chHit[0].object;
            while (obj && obj.userData.type !== 'chest') obj = obj.parent;
            if (obj && !obj.userData.opened) { openChest(obj); return; }
        }

        // Check doors
        const doorHit = rc2.intersectObjects(builds, true);
        if (doorHit.length > 0) {
            let obj = doorHit[0].object;
            if (obj.userData && obj.userData.type === 'door' && doorHit[0].distance < 4) {
                obj.userData.opened = !obj.userData.opened;
                obj.rotation.y = obj.userData.opened ? obj.userData.openRy : obj.userData.closedRy;
                obj.updateMatrixWorld();
                obj.userData.bb = new THREE.Box3().setFromObject(obj);
                return;
            }
        }
    }
    if (gamePhase !== 'playing') return;
    keys[e.code] = true;
    if (e.code === 'KeyQ' && mode !== 'edit') {
        mode = mode === 'combat' ? 'build' : 'combat';
        deselectEdit(); updGhost(); updHUD();
    }
    if (e.code === 'KeyE') {
        if (mode === 'edit') exitEditMode();
        else enterEditMode();
    }
    if (e.code === 'KeyR') {
        if (mode === 'edit') editRotate();
        else if (mode === 'build') bRot = (bRot + 1) % 4;
        else if (mode === 'combat') reloadWpn();
    }
    if (e.code === 'KeyX' && mode === 'edit') editDelete();
    if (e.code === 'KeyF' && mode === 'edit') editStartMove();
    if (e.code === 'Digit1') {
        if (mode === 'combat' && pInv.includes(0)) { selW = 0; mkFPW(0); }
        else if (mode === 'build') { selB = 0; updGhost(); }
        updHUD();
    }
    if (e.code === 'Digit2') {
        if (mode === 'combat' && pInv.includes(1)) { selW = 1; mkFPW(1); }
        else if (mode === 'build') { selB = 1; updGhost(); }
        updHUD();
    }
    if (e.code === 'Digit3') {
        if (mode === 'combat' && pInv.includes(2)) { selW = 2; mkFPW(2); }
        else if (mode === 'build') { selB = 2; updGhost(); }
        updHUD();
    }
    if (e.code === 'Digit4') {
        if (mode === 'combat' && pConsumables.length >= 1) { selW = 3; mkFPW(3); }
        else if (mode === 'build') { selB = 3; updGhost(); }
        updHUD();
    }
    if (e.code === 'Digit5') {
        if (mode === 'combat' && pConsumables.length >= 2) { selW = 4; mkFPW(4); }
        else if (mode === 'build') { selB = 4; updGhost(); }
        updHUD();
    }
});
document.addEventListener('keyup', e => keys[e.code] = false);

// Pointer Lock
document.getElementById('playBtn').addEventListener('click', () => {
    ren.domElement.requestPointerLock();
    if (gamePhase === 'menu') startBattleRoyale();
});
document.addEventListener('click', () => {
    if (gamePhase !== 'menu' && !locked) {
        ren.domElement.requestPointerLock();
    }
});
document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === ren.domElement;
    if (gamePhase === 'menu') {
        document.getElementById('startScreen').style.display = locked ? 'none' : 'flex';
    } else {
        // If we unlock during gameplay, show the menu so they know to click
        if (!locked) document.getElementById('startScreen').style.display = 'flex';
        else document.getElementById('startScreen').style.display = 'none';
    }
    if (locked) document.getElementById('hud').classList.add('active');
    else if (gamePhase === 'menu') document.getElementById('hud').classList.remove('active');
});
document.addEventListener('mousemove', e => {
    if (!locked) return;
    euler.setFromQuaternion(cam.quaternion);
    euler.y -= e.movementX * SENS; euler.x -= e.movementY * SENS;
    euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
    cam.quaternion.setFromEuler(euler);
});
document.addEventListener('mousedown', e => {
    if (!locked || e.button !== 0 || gamePhase !== 'playing') return;
    if (mode === 'combat') shoot();
    else if (mode === 'build') placeBuild();
    else if (mode === 'edit') editClick();
});

// Collision - ALL buildings are now solid
function chkCol(np) {
    const colCenter = np.clone().setY(np.y - PH / 2);
    const pb = new THREE.Box3().setFromCenterAndSize(colCenter, new THREE.Vector3(0.6, PH, 0.6));
    for (let i = 0; i < builds.length; i++) {
        const b = builds[i];
        if (!b.userData.bb) b.userData.bb = new THREE.Box3().setFromObject(b);
        const bb = b.userData.bb;
        // For ramps, only block if player center is inside the solid part
        if (b.userData.type === 'ramp') {
            const rampH = getRampH(b, np);
            if (rampH !== null && np.y - PH < rampH - 0.1) {
                // Player is trying to walk through the solid part of the ramp
                return false;
            }
            continue;
        }
        if (pb.intersectsBox(bb)) return false;
    }
    return true;
}
// Get ramp height at a given XZ position using local coordinates for rotation accuracy
function getRampH(ramp, p) {
    const lp = ramp.worldToLocal(p.clone());
    const G2 = 2; // G/2
    if (lp.x > -G2 && lp.x < G2 && lp.z > -G2 && lp.z < G2) {
        return ramp.position.y + (lp.x + G2);
    }
    return null;
}
function groundH(p) {
    let h = getTerrainH(p.x, p.z);
    for (let i = 0; i < builds.length; i++) {
        const b = builds[i];
        if (b.userData.type !== 'floor' && b.userData.type !== 'ramp') continue;
        if (b.userData.type === 'floor') {
            if (!b.userData.bb) b.userData.bb = new THREE.Box3().setFromObject(b);
            const bb = b.userData.bb;
            if (p.x > bb.min.x && p.x < bb.max.x && p.z > bb.min.z && p.z < bb.max.z) {
                if (bb.max.y < p.y + 0.1 && bb.max.y > h) h = bb.max.y;
            }
        } else if (b.userData.type === 'ramp') {
            const sh = getRampH(b, p);
            if (sh !== null && sh < p.y + 0.5 && sh > h) h = sh;
        }
    }
    return h;
}

// Enemy AI (aggressive, targets player and other bots)
function updEnemy(dt) {
    if (gamePhase !== 'playing') return;
    const px = cam.position.x, py = cam.position.y, pz = cam.position.z;
    const now = Date.now();
    bots.forEach(bot => {
        // Find closest target (player or another bot)
        let target = null;
        let minDist = Infinity;
        let seekingLoot = false;

        // Find loot if unarmed
        if (!bot.userData.hasWeapon) {
            // Priority 1: Loose weapon loot on ground
            lootItems.forEach(l => {
                if (l.userData.loot && l.userData.loot.type === 'weapon') {
                    const dist = bot.position.distanceToSquared(l.position);
                    if (dist < minDist) { minDist = dist; target = l; seekingLoot = true; }
                }
            });
            // Priority 2: Unopened chests
            if (!target) {
                chests.forEach(c => {
                    if (!c.userData.opened) {
                        const dist = bot.position.distanceToSquared(c.position);
                        if (dist < minDist) { minDist = dist; target = c; seekingLoot = true; }
                    }
                });
            }
        }

        // If has weapon OR no loot found, fight!
        if (!seekingLoot) {
            minDist = Infinity;
            const distToPlayer = bot.position.distanceToSquared(new THREE.Vector3(px, bot.position.y, pz));
            if (distToPlayer < 6400 && pHP > 0) { target = 'player'; minDist = distToPlayer; }
            bots.forEach(otherBot => {
                if (otherBot === bot) return;
                const dist = bot.position.distanceToSquared(otherBot.position);
                if (dist < 6400 && dist < minDist) { target = otherBot; minDist = dist; }
            });
        }

        if (!target) return; // Sleep if no targets nearby

        let tx = px, ty = py, tz = pz;
        if (target !== 'player' && target.position) { tx = target.position.x; ty = target.position.y; tz = target.position.z; }

        // Move towards target with collision detection
        const speed = 6.5; 
        const dx = tx - bot.position.x, dz = tz - bot.position.z;
        const distTarget = Math.sqrt(dx * dx + dz * dz);

        // Loot Interaction
        if (seekingLoot && distTarget < 4) {
            if (target.userData.type === 'chest' && !target.userData.opened) {
                openChest(target);
            } else if (target.userData.type === 'loot') {
                bot.userData.hasWeapon = true;
                if (target.userData.loot) bot.userData.wpnIdx = target.userData.loot.wpnIdx;
                scene.remove(target);
                lootItems = lootItems.filter(l => l !== target);
            }
            return; 
        }

        const np = bot.position.clone();
        
        // Forward/Backward movement
        if (distTarget > (seekingLoot ? 0.5 : 4.5)) {
            np.x += (dx / distTarget) * speed * dt;
            np.z += (dz / distTarget) * speed * dt;
        } else if (!seekingLoot && distTarget < 3) {
            np.x -= (dx / distTarget) * speed * dt;
            np.z -= (dz / distTarget) * speed * dt;
        }

        // Strafing movement (to avoid staying static)
        if (!seekingLoot) {
            if (!bot.userData.strafeDir) bot.userData.strafeDir = Math.random() > 0.5 ? 1 : -1;
            if (Math.random() < 0.01) bot.userData.strafeDir *= -1; // Change direction occasionally
            
            const sx = -dz / distTarget;
            const sz = dx / distTarget;
            np.x += sx * (speed * 0.7) * dt * bot.userData.strafeDir;
            np.z += sz * (speed * 0.7) * dt * bot.userData.strafeDir;
        }
        np.y = getTerrainH(np.x, np.z);

        const colTest = np.clone(); colTest.y += PH; // Adjust Y for chkCol logic (expects eye level)
        if (chkCol(colTest)) {
            bot.position.copy(np);
        } else {
            // Sliding logic
            const tryX = bot.position.clone(); tryX.x = np.x; tryX.y = getTerrainH(tryX.x, tryX.z);
            const ctX = tryX.clone(); ctX.y += PH;
            if (chkCol(ctX)) {
                bot.position.copy(tryX);
            } else {
                const tryZ = bot.position.clone(); tryZ.z = np.z; tryZ.y = getTerrainH(tryZ.x, tryZ.z);
                const ctZ = tryZ.clone(); ctZ.y += PH;
                if (chkCol(ctZ)) bot.position.copy(tryZ);
            }
        }

        // Terrain follow and jump occasionally
        bot.userData.t += dt;
        const gh = getTerrainH(bot.position.x, bot.position.z);
        if (bot.userData.t > 1.5 && Math.random() < 0.3) {
            bot.position.y = gh + 2; // Jump
            bot.userData.t = 0;
        } else {
            bot.position.y += (gh - bot.position.y) * 10 * dt; // gravity to terrain
        }

        bot.position.x = Math.max(-190, Math.min(190, bot.position.x));
        bot.position.z = Math.max(-190, Math.min(190, bot.position.z));
        bot.lookAt(tx, bot.position.y, tz);

        // Shoot (only if has weapon)
        if (!bot.userData.hasWeapon) return;

        if (!bot.userData.lastFire) bot.userData.lastFire = 0;
        if (now - bot.userData.lastFire > 600 && distTarget < 8 && Math.random() < 0.6) {
            bot.userData.lastFire = now;

            const startP = bot.position.clone(); startP.y += 1.0;
            const targetP = new THREE.Vector3(tx, ty + (target === 'player' ? 0 : 1.0), tz);
            const dir = targetP.clone().sub(startP).normalize();

            // Raycast check against structures
            const rc = new THREE.Raycaster(startP, dir);
            const bHits = rc.intersectObjects(builds);
            let hitBuild = null;
            if (bHits.length > 0 && bHits[0].distance < distTarget) {
                hitBuild = bHits[0].object;
            }

            const endP = hitBuild ? bHits[0].point : targetP;
            const tracerDist = startP.distanceTo(endP);
            // Tracer drawing removed since bots use fists

            // Damage calculation
            if (hitBuild) {
                hitBuild.userData.hp -= 20;
                const origColor = hitBuild.material.color.getHex();
                hitBuild.material.color.setHex(0xff4444);
                setTimeout(() => { if (hitBuild.material) hitBuild.material.color.setHex(origColor); }, 100);
                if (hitBuild.userData.hp <= 0) {
                    scene.remove(hitBuild);
                    builds = builds.filter(x => x !== hitBuild);
                }
            } else {
                if (target === 'player') {
                    if (Math.random() < 0.3) {
                        const dmg = (bot.userData.wpnIdx !== undefined) ? WPN[bot.userData.wpnIdx].dmg : 25;
                        if (pShield > 0) {
                            const sDmg = Math.min(pShield, dmg);
                            pShield -= sDmg;
                            const hpDmg = dmg - sDmg;
                            pHP -= hpDmg;
                        } else { pHP -= dmg; }
                        updHUD();
                        showHit();
                        if (pHP <= 0) playerDie('¡ELIMINADO POR BOT!');
                    }
                } else {
                    if (Math.random() < 0.5) {
                        const dmg = (bot.userData.wpnIdx !== undefined) ? WPN[bot.userData.wpnIdx].dmg : 25;
                        if (target.userData.shield > 0) {
                            const sDmg = Math.min(target.userData.shield, dmg);
                            target.userData.shield -= sDmg;
                            target.userData.hp -= (dmg - sDmg);
                        } else {
                            target.userData.hp -= dmg;
                        }
                        if (target.userData.hp <= 0) handleBotDeath(target, 'bot');
                    }
                }
            }
        }
    });
}

// Game Loop
let prev = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now(), dt = Math.min((now - prev) / 1000, 0.1); prev = now;

    // Bus phase removed

    // === DROPPING PHASE ===
    if (gamePhase === 'dropping') {
        vel.y -= GRV * 0.3 * dt;
        cam.position.y += vel.y * dt;
        const gh = groundH(cam.position);
        if (cam.position.y <= gh + PH) {
            cam.position.y = gh + PH; vel.y = 0; canJ = true;
            gamePhase = 'playing';
            if (busGroup) { scene.remove(busGroup); busGroup = null; }
        }
    }

    // === PLAYING PHASE ===
    if (locked && gamePhase === 'playing') {
        if (botsAlive === 0) {
            gamePhase = 'victory';
            document.getElementById('vicStats').textContent = 'ELIMINACIONES: ' + kills;
            document.getElementById('victoryScreen').classList.add('active');
            setTimeout(() => {
                document.getElementById('victoryScreen').classList.remove('active');
                document.getElementById('hud').classList.remove('active');
                document.getElementById('startScreen').style.display = 'flex';
                document.exitPointerLock();
                gamePhase = 'menu';
            }, 8000);
            return;
        }
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
        const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion); rt.y = 0; rt.normalize();
        const mv = new THREE.Vector3();
        if (keys['KeyW']) mv.add(fwd); if (keys['KeyS']) mv.sub(fwd);
        if (keys['KeyD']) mv.add(rt); if (keys['KeyA']) mv.sub(rt);
        if (mv.length() > 0) mv.normalize();
        vel.y -= GRV * dt;
        if (keys['Space'] && canJ) { vel.y = JMP; canJ = false; }
        const np = cam.position.clone();
        np.x += mv.x * SPD * dt; np.z += mv.z * SPD * dt; np.y += vel.y * dt;
        const gh = groundH(np);
        if (np.y < gh + PH) { np.y = gh + PH; vel.y = 0; canJ = true; }
        if (chkCol(np)) cam.position.copy(np);
        else {
            const sx = cam.position.clone(); sx.x = np.x; sx.y = np.y;
            if (chkCol(sx)) cam.position.copy(sx);
            else { const sz = cam.position.clone(); sz.z = np.z; sz.y = np.y; if (chkCol(sz)) cam.position.copy(sz); else cam.position.y = np.y; }
        }

        // Storm logic
        stormTimer += dt;
        const progress = Math.min(1, stormTimer / 120); // 2 minutes to close
        stormRadius = 400 * (1 - progress);
        if (stormRadius < 1) stormRadius = 1;
        stormMesh.scale.set(stormRadius, 1, stormRadius);

        if (now - lastStormDmgT >= 1500) {
            lastStormDmgT = now;
            // Check player
            const pDist = Math.sqrt(Math.pow(cam.position.x - stormCenter.x, 2) + Math.pow(cam.position.z - stormCenter.z, 2));
            if (pDist > stormRadius && pHP > 0) {
                pHP -= 5;
                if (pHP <= 0) { pHP = 0; playerDie('¡ELIMINADO POR LA LLUVIA!'); }
                else { showDamage(5, cam.position); updHUD(); }
            }
            // Check bots
            bots.forEach(bot => {
                if (bot.userData.hp > 0) {
                    const bDist = Math.sqrt(Math.pow(bot.position.x - stormCenter.x, 2) + Math.pow(bot.position.z - stormCenter.z, 2));
                    if (bDist > stormRadius) {
                        bot.userData.hp -= 5;
                        if (bot.userData.hp <= 0) handleBotDeath(bot, 'storm');
                    }
                }
            });
        }

        if (mode === 'build') posGhost();
        if (mode === 'edit') posEditGhost();
        updEnemy(dt);
        if (cam.position.y < WATER_Y + PH + 0.2 && (cam.position.x < -95 || cam.position.x > 95 || cam.position.z < -95 || cam.position.z > 95)) { playerDie('\u00a1CA\u00cdSTE AL AGUA!'); }
        if (cam.position.y < -10) { playerDie('\u00a1CA\u00cdSTE AL VAC\u00cdO!'); }
        if (fpG.children[0] && mv.length() > 0) { fpG.children[0].position.y = -0.25 + Math.sin(now * 0.008) * 0.015; }
        
        // MULTIPLAYER: Send position to server
        if (socket && gamePhase === 'playing') {
            socket.emit('playerMovement', {
                x: cam.position.x,
                y: cam.position.y,
                z: cam.position.z,
                rotation: cam.rotation.y
            });
        }
    }
    // Loot bobbing
    lootItems.forEach(l => { l.position.y = (l.userData.baseY || 0.5) + Math.sin(now * 0.003 + l.userData.bobPhase) * 0.15; l.rotation.y += dt; });

    for (let i = tracers.length - 1; i >= 0; i--) {
        if (Date.now() - tracers[i].userData.born > 80) { scene.remove(tracers[i]); tracers.splice(i, 1); }
    }
    const wt = now * 0.00003;
    waterTex.offset.set(wt, wt * 0.7);
    updateDayCycle(dt);
    drawMinimap();
    ren.render(scene, cam);
}

// Victory back button
const vicBack = document.getElementById('vicBack');
if (vicBack) vicBack.addEventListener('click', () => {
    document.getElementById('victoryScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
    document.exitPointerLock(); gamePhase = 'menu';
});

function drawMinimap() {
    const cvs = document.getElementById('minimap');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, 150, 150);
    // Circular clip
    ctx.save();
    ctx.beginPath(); ctx.arc(75, 75, 73, 0, Math.PI * 2); ctx.clip();
    // Background
    ctx.fillStyle = 'rgba(10,14,26,0.9)';
    ctx.fillRect(0, 0, 150, 150);

    const scale = 75 / 150;

    // Draw storm (purple rain)
    const stX = 75 + (stormCenter.x - cam.position.x) * scale;
    const stZ = 75 + (stormCenter.z - cam.position.z) * scale;
    const stR = stormRadius * scale;
    ctx.fillStyle = 'rgba(136, 0, 255, 0.4)';
    ctx.fillRect(0, 0, 150, 150);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(stX, stZ, stR, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#8800ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(stX, stZ, stR, 0, Math.PI * 2); ctx.stroke();

    // Chests (yellow dots)
    ctx.fillStyle = '#fdd835';
    chests.forEach(c => {
        if (c.userData.opened) return;
        const mx = 75 + (c.position.x - cam.position.x) * scale;
        const my = 75 + (c.position.z - cam.position.z) * scale;
        if (mx >= 2 && mx <= 148 && my >= 2 && my <= 148) {
            ctx.fillRect(mx - 2, my - 2, 4, 4);
        }
    });
    // Bots (red dots)
    ctx.fillStyle = '#ff3d00';
    bots.forEach(b => {
        const mx = 75 + (b.position.x - cam.position.x) * scale;
        const my = 75 + (b.position.z - cam.position.z) * scale;
        if (mx >= 2 && mx <= 148 && my >= 2 && my <= 148) {
            ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
        }
    });
    // Player (center)
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath(); ctx.arc(75, 75, 4, 0, Math.PI * 2); ctx.fill();
    // View direction
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    ctx.strokeStyle = 'rgba(0,229,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(75, 75); ctx.lineTo(75 + dir.x * 15, 75 + dir.z * 15); ctx.stroke();
    ctx.restore();
}
window.addEventListener('resize', () => { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); ren.setSize(innerWidth, innerHeight); });
updHUD(); animate();
