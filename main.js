import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import JSZip from 'jszip';

// ==========================================
// 1. SCENE, CAMERA, & SHADOW RENDERER SETUP
// ==========================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x88bbff, 0.005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ==========================================
// 2. DAY / NIGHT CYCLE & FLASHLIGHT
// ==========================================
const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 150;
const d = 50;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// Player Flashlight
const flashlight = new THREE.SpotLight(0xfffaed, 8, 40, Math.PI / 6, 0.4, 1);
flashlight.castShadow = true;
flashlight.visible = false;
camera.add(flashlight);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -1);
camera.add(flashlight.target);

let dayNightTime = 0; // 0 to 600 seconds (10 mins total cycle)

function updateDayNight(delta) {
    dayNightTime = (dayNightTime + delta) % 600; 
    const angle = (dayNightTime / 600) * Math.PI * 2;

    sunLight.position.x = Math.cos(angle) * 80;
    sunLight.position.y = Math.sin(angle) * 80;
    sunLight.position.z = Math.sin(angle * 0.5) * 40;

    const isDay = sunLight.position.y > 0;
    const transition = Math.max(0, Math.min(1, sunLight.position.y / 10));

    sunLight.intensity = transition * 2.5;
    ambientLight.intensity = 0.05 + transition * 0.35;
    scene.fog.density = isDay ? 0.003 : 0.015;
}

// ==========================================
// 3. EXR & PBR ASSET LOADING PIPELINE
// ==========================================
const exrLoader = new EXRLoader();
exrLoader.load('https://filebin.net/cs85jyze29af9ebj/je_gray_02_4k.exr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
});

async function loadMaterialFromZip(zipUrl, materialOptions = {}) {
    const material = new THREE.MeshStandardMaterial(materialOptions);
    try {
        const response = await fetch(zipUrl);
        const blob = await response.blob();
        const zip = await JSZip.loadAsync(blob);

        for (const [filename, file] of Object.entries(zip.files)) {
            if (!file.dir && /\.(jpg|jpeg|png)$/i.test(filename)) {
                const fileBlob = await file.async('blob');
                const objectUrl = URL.createObjectURL(fileBlob);
                const texture = new THREE.TextureLoader().load(objectUrl);
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;

                if (/color|diffuse|albedo|basecolor/i.test(filename)) {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    material.map = texture;
                } else if (/normal|nrm/i.test(filename)) {
                    material.normalMap = texture;
                } else if (/rough|rgh/i.test(filename)) {
                    material.roughnessMap = texture;
                } else if (/alpha|trans|opacity|mask/i.test(filename)) {
                    material.alphaMap = texture;
                    material.transparent = true;
                }
            }
        }
        material.needsUpdate = true;
    } catch (e) {
        console.error("Zip loading error:", e);
    }
    return material;
}

const loadedMats = {
    bark1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark1.zip', { roughness: 0.85 }),
    bark2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark2.zip', { roughness: 0.85 }),
    ground: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Ground1.zip', { roughness: 0.9 }),
    grass: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Grass1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    leaf1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    leaf2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf2.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 })
};

// ==========================================
// 4. TERRAIN WITH HILLS & GRASS EVERYWHERE
// ==========================================
function getTerrainHeight(x, z) {
    return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3 + Math.sin(x * 0.02) * 5;
}

const terrainGeo = new THREE.PlaneGeometry(250, 250, 80, 80);
terrainGeo.rotateX(-Math.PI / 2);

const posAttr = terrainGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(x, z));
}
terrainGeo.computeVertexNormals();

let groundMesh;
loadedMats.ground.then((mat) => {
    if (mat.map) mat.map.repeat.set(25, 25);
    groundMesh = new THREE.Mesh(terrainGeo, mat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
});

// Grass InstancedMesh
const grassBladeGeo = new THREE.PlaneGeometry(0.4, 1.2);
grassBladeGeo.translate(0, 0.6, 0);

loadedMats.grass.then((mat) => {
    const grassCount = 6000;
    const instancedGrass = new THREE.InstancedMesh(grassBladeGeo, mat, grassCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < grassCount; i++) {
        const x = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        const y = getTerrainHeight(x, z);

        dummy.position.set(x, y, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(1, 0.8 + Math.random() * 0.5, 1);
        dummy.updateMatrix();

        instancedGrass.setMatrixAt(i, dummy.matrix);
    }
    instancedGrass.receiveShadow = true;
    scene.add(instancedGrass);
});

// Procedural Forest Trees
const treesGroup = new THREE.Group();
scene.add(treesGroup);

Promise.all([loadedMats.bark1, loadedMats.bark2, loadedMats.leaf1, loadedMats.leaf2]).then(([b1, b2, l1, l2]) => {
    const barks = [b1, b2];
    const leaves = [l1, l2];

    for (let i = 0; i < 40; i++) {
        const x = (Math.random() - 0.5) * 180;
        const z = (Math.random() - 0.5) * 180;
        if (Math.hypot(x, z) < 15) continue; // Keep spawn clear

        const y = getTerrainHeight(x, z);
        const randBark = barks[Math.floor(Math.random() * barks.length)];
        const randLeaf = leaves[Math.floor(Math.random() * leaves.length)];

        const tree = new THREE.Group();
        tree.position.set(x, y, z);

        // Trunk
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 6, 8), randBark);
        trunk.position.y = 3;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        tree.add(trunk);

        // Foliage Crown
        for (let j = 0; j < 3; j++) {
            const crown = new THREE.Mesh(new THREE.ConeGeometry(3 - j * 0.6, 4, 8), randLeaf);
            crown.position.y = 4.5 + j * 2;
            crown.castShadow = true;
            tree.add(crown);
        }

        treesGroup.add(tree);
    }
});

// ==========================================
// 5. WEAPON, AMMO, RECOIL & SCOPE
// ==========================================
const gunGroup = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.8 }));
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.02, -0.35);

const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25), new THREE.MeshStandardMaterial({ color: 0x111111 }));
scope.rotation.x = Math.PI / 2;
scope.position.set(0, 0.08, -0.1);

gunGroup.add(gunBody, gunBarrel, scope);
gunGroup.position.set(0.22, -0.2, -0.4);
camera.add(gunGroup);
scene.add(camera);

// Inventory & Ammo State
const ammoState = {
    loaded: 5,
    maxClip: 5,
    reserve: 20,
    woodResources: 0,
    isScoped: false,
    isReloading: false
};

const projectiles = [];

function shootGun() {
    if (ammoState.isReloading) return;
    if (ammoState.loaded <= 0) {
        reloadGun();
        return;
    }

    ammoState.loaded--;
    updateUI();

    // Recoil Kick
    gunGroup.position.z += 0.06;
    gunGroup.rotation.x += 0.1;
    setTimeout(() => {
        gunGroup.position.z -= 0.06;
        gunGroup.rotation.x -= 0.1;
    }, 60);

    // Bullet Projectile
    const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    const worldPos = new THREE.Vector3();
    gunBarrel.getWorldPosition(worldPos);
    bullet.position.copy(worldPos);

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    bullet.userData = { velocity: dir.multiplyScalar(3.0), life: 40 };

    scene.add(bullet);
    projectiles.push(bullet);
}

function reloadGun() {
    if (ammoState.isReloading || ammoState.loaded === ammoState.maxClip || ammoState.reserve <= 0) return;
    ammoState.isReloading = true;
    updateUI("Reloading...");

    // Reload Motion
    gunGroup.position.y -= 0.15;
    setTimeout(() => {
        const needed = ammoState.maxClip - ammoState.loaded;
        const available = Math.min(needed, ammoState.reserve);
        ammoState.loaded += available;
        ammoState.reserve -= available;
        ammoState.isReloading = false;
        gunGroup.position.y += 0.15;
        updateUI();
    }, 1200);
}

function craftAmmo() {
    if (ammoState.woodResources >= 2) {
        ammoState.woodResources -= 2;
        ammoState.reserve += 5;
        updateUI("Crafted +5 Ammo!");
    } else {
        updateUI("Need 2 Wood!");
    }
}

// ==========================================
// 6. DINOSAURS & FALLING ANIMATION
// ==========================================
const dinosaurs = [];
const dinoGeo = new THREE.CapsuleGeometry(0.7, 1.8, 4, 8);
const dinoMat = new THREE.MeshStandardMaterial({ color: 0x2b5438, roughness: 0.7 });

for (let i = 0; i < 6; i++) {
    const dino = new THREE.Mesh(dinoGeo, dinoMat);
    const x = (Math.random() - 0.5) * 60;
    const z = -15 - Math.random() * 50;
    dino.position.set(x, getTerrainHeight(x, z) + 1.2, z);
    dino.castShadow = true;
    dino.userData = { health: 3, isFalling: false, fallAngle: 0 };
    scene.add(dino);
    dinosaurs.push(dino);
}

function updateDinosaurs() {
    for (let dino of dinosaurs) {
        if (dino.userData.isFalling) {
            dino.userData.fallAngle += 0.08;
            dino.rotation.z = Math.min(Math.PI / 2, dino.userData.fallAngle);
            if (dino.userData.fallAngle >= Math.PI / 2) {
                // Respawn after fall completes
                setTimeout(() => {
                    const nx = (Math.random() - 0.5) * 80;
                    const nz = -20 - Math.random() * 60;
                    dino.position.set(nx, getTerrainHeight(nx, nz) + 1.2, nz);
                    dino.rotation.z = 0;
                    dino.userData.health = 3;
                    dino.userData.isFalling = false;
                    dino.userData.fallAngle = 0;
                }, 1000);
            }
        }
    }
}

// ==========================================
// 7. MOBILE UI CONTROLS & HUD
// ==========================================
const ui = document.createElement('div');
ui.innerHTML = `
    <style>
        #hud { position: absolute; top: 15px; left: 15px; color: white; font-family: monospace; font-size: 16px; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 8px; pointer-events: none; }
        #joystick-zone { position: absolute; bottom: 25px; left: 25px; width: 120px; height: 120px; background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.4); border-radius: 50%; touch-action: none; }
        #joystick-knob { position: absolute; top: 35px; left: 35px; width: 50px; height: 50px; background: rgba(255,255,255,0.6); border-radius: 50%; pointer-events: none; }
        .btn { position: absolute; background: rgba(0,0,0,0.6); color: white; border: 1.5px solid white; border-radius: 8px; font-family: sans-serif; font-size: 13px; font-weight: bold; text-align: center; user-select: none; touch-action: manipulation; }
        #shoot-btn { bottom: 35px; right: 25px; width: 75px; height: 75px; border-radius: 50%; background: rgba(220,40,40,0.7); line-height: 75px; }
        #scope-btn { bottom: 125px; right: 35px; width: 55px; height: 55px; border-radius: 50%; line-height: 55px; }
        #reload-btn { bottom: 35px; right: 115px; width: 55px; height: 55px; border-radius: 50%; line-height: 55px; }
        #sprint-btn { bottom: 190px; right: 35px; width: 55px; height: 40px; line-height: 40px; }
        #fly-toggle { top: 15px; right: 15px; width: 80px; height: 35px; line-height: 35px; }
        #fly-up { top: 60px; right: 15px; width: 40px; height: 40px; line-height: 40px; display: none; }
        #fly-down { top: 105px; right: 15px; width: 40px; height: 40px; line-height: 40px; display: none; }
        #light-btn { top: 155px; right: 15px; width: 80px; height: 35px; line-height: 35px; }
        #craft-btn { top: 200px; right: 15px; width: 80px; height: 35px; line-height: 35px; background: rgba(40,160,60,0.7); }
        #crosshair { position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; background: red; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; }
    </style>
    <div id="hud">AMMO: 5 / 20<br>WOOD: 0</div>
    <div id="crosshair"></div>
    <div id="joystick-zone"><div id="joystick-knob"></div></div>
    <div id="shoot-btn" class="btn">FIRE</div>
    <div id="scope-btn" class="btn">SCOPE</div>
    <div id="reload-btn" class="btn">RELOAD</div>
    <div id="sprint-btn" class="btn">WALK</div>
    <div id="fly-toggle" class="btn">FLY: OFF</div>
    <div id="fly-up" class="btn">▲</div>
    <div id="fly-down" class="btn">▼</div>
    <div id="light-btn" class="btn">LIGHT</div>
    <div id="craft-btn" class="btn">CRAFT</div>
`;
document.body.appendChild(ui);

const hud = document.getElementById('hud');
function updateUI(status) {
    hud.innerHTML = status || `AMMO: ${ammoState.loaded} / ${ammoState.reserve}<br>WOOD: ${ammoState.woodResources}`;
}

// Controller States
const player = {
    moveFwd: 0, moveRight: 0, yaw: 0, pitch: 0,
    isSprinting: false, isFlying: false, flyVel: 0
};

// Joystick Logic
const joyZone = document.getElementById('joystick-zone');
const joyKnob = document.getElementById('joystick-knob');
let joyTouchId = null;

joyZone.addEventListener('touchstart', (e) => {
    if (joyTouchId === null) joyTouchId = e.changedTouches[0].identifier;
});

joyZone.addEventListener('touchmove', (e) => {
    for (let t of e.changedTouches) {
        if (t.identifier === joyTouchId) {
            const rect = joyZone.getBoundingClientRect();
            const dx = t.clientX - (rect.left + rect.width / 2);
            const dy = t.clientY - (rect.top + rect.height / 2);
            const dist = Math.min(rect.width / 2, Math.hypot(dx, dy));
            const angle = Math.atan2(dy, dx);

            joyKnob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
            player.moveRight = (Math.cos(angle) * dist) / (rect.width / 2);
            player.moveFwd = -(Math.sin(angle) * dist) / (rect.width / 2);
        }
    }
});

function resetJoy() {
    joyTouchId = null;
    joyKnob.style.transform = `translate(0px, 0px)`;
    player.moveFwd = 0;
    player.moveRight = 0;
}
joyZone.addEventListener('touchend', resetJoy);
joyZone.addEventListener('touchcancel', resetJoy);

// Drag to Aim Look Controls
let isLooking = false, lastX = 0, lastY = 0;
window.addEventListener('touchstart', (e) => {
    if (e.target.id !== 'joystick-zone' && !e.target.classList.contains('btn')) {
        isLooking = true;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    }
});
window.addEventListener('touchmove', (e) => {
    if (!isLooking) return;
    const dx = e.touches[0].clientX - lastX;
    const dy = e.touches[0].clientY - lastY;
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;

    const sens = ammoState.isScoped ? 0.002 : 0.005;
    player.yaw -= dx * sens;
    player.pitch -= dy * sens;
    player.pitch = Math.max(-Math.PI / 2.4, Math.min(Math.PI / 2.4, player.pitch));

    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.x = player.pitch;
    euler.y = player.yaw;
    camera.quaternion.setFromEuler(euler);
});
window.addEventListener('touchend', () => isLooking = false);

// Button Binding Setup
document.getElementById('shoot-btn').addEventListener('click', shootGun);
document.getElementById('reload-btn').addEventListener('click', reloadGun);
document.getElementById('craft-btn').addEventListener('click', craftAmmo);

document.getElementById('light-btn').addEventListener('click', () => {
    flashlight.visible = !flashlight.visible;
});

document.getElementById('scope-btn').addEventListener('click', () => {
    ammoState.isScoped = !ammoState.isScoped;
    camera.fov = ammoState.isScoped ? 30 : 75;
    camera.updateProjectionMatrix();
    gunGroup.position.set(ammoState.isScoped ? 0 : 0.22, ammoState.isScoped ? -0.12 : -0.2, ammoState.isScoped ? -0.25 : -0.4);
});

document.getElementById('sprint-btn').addEventListener('click', (e) => {
    player.isSprinting = !player.isSprinting;
    e.target.innerText = player.isSprinting ? 'SPRINT' : 'WALK';
});

const flyUpBtn = document.getElementById('fly-up');
const flyDownBtn = document.getElementById('fly-down');

document.getElementById('fly-toggle').addEventListener('click', (e) => {
    player.isFlying = !player.isFlying;
    e.target.innerText = player.isFlying ? 'FLY: ON' : 'FLY: OFF';
    flyUpBtn.style.display = player.isFlying ? 'block' : 'none';
    flyDownBtn.style.display = player.isFlying ? 'block' : 'none';
});

flyUpBtn.addEventListener('touchstart', () => player.flyVel = 1);
flyUpBtn.addEventListener('touchend', () => player.flyVel = 0);
flyDownBtn.addEventListener('touchstart', () => player.flyVel = -1);
flyDownBtn.addEventListener('touchend', () => player.flyVel = 0);

// ==========================================
// 8. GAME LOOP & UPDATES
// ==========================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    updateDayNight(delta);
    updateDinosaurs();

    // Movement Physics
    const speed = player.isFlying ? 0.35 : (player.isSprinting ? 0.28 : 0.12);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    if (!player.isFlying) fwd.y = 0;
    fwd.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    camera.position.addScaledVector(fwd, player.moveFwd * speed);
    camera.position.addScaledVector(right, player.moveRight * speed);

    if (player.isFlying) {
        camera.position.y += player.flyVel * 0.25;
    } else {
        const groundY = getTerrainHeight(camera.position.x, camera.position.z);
        camera.position.y = groundY + 1.8;
    }

    // Bullet Trajectory & Dinosaur Collision Detection
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const b = projectiles[i];
        b.position.add(b.userData.velocity);
        b.userData.life--;

        for (let dino of dinosaurs) {
            if (!dino.userData.isFalling && b.position.distanceTo(dino.position) < 1.4) {
                dino.userData.health--;
                b.userData.life = 0;
                if (dino.userData.health <= 0) {
                    dino.userData.isFalling = true; // Trigger fall animation
                    ammoState.woodResources++; // Gain wood reward
                    updateUI();
                }
            }
        }

        if (b.userData.life <= 0) {
            scene.remove(b);
            projectiles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
