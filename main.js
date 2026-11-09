import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import JSZip from 'jszip';

// Prevent mobile browser default drag / pinch-zoom behaviors
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ==========================================
// 1. SCENE, CAMERA, & RENDERER SETUP
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88bbff); // Instant fallback so it's never gray
scene.fog = new THREE.FogExp2(0x88bbff, 0.004);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Lighting & Shadows
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
sunLight.position.set(30, 50, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 150;
const d = 40;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// Flashlight
const flashlight = new THREE.SpotLight(0xfffaed, 8, 40, Math.PI / 6, 0.4, 1);
flashlight.castShadow = true;
flashlight.visible = false;
camera.add(flashlight);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -1);
camera.add(flashlight.target);

let dayNightTime = 0; // 10-minute cycle
function updateDayNight(delta) {
    dayNightTime = (dayNightTime + delta) % 600;
    const angle = (dayNightTime / 600) * Math.PI * 2;
    sunLight.position.x = Math.cos(angle) * 70;
    sunLight.position.y = Math.sin(angle) * 70;
    
    const isDay = sunLight.position.y > 0;
    const transition = Math.max(0, Math.min(1, sunLight.position.y / 15));
    sunLight.intensity = transition * 2.2;
    ambientLight.intensity = 0.1 + transition * 0.35;
    scene.fog.density = isDay ? 0.003 : 0.012;
}

// ==========================================
// 2. EXR & PBR TEXTURE PIPELINE
// ==========================================
const exrLoader = new EXRLoader();
exrLoader.load('https://filebin.net/cs85jyze29af9ebj/je_gray_02_4k.exr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
}, undefined, (err) => {
    console.warn("EXR background fallback active:", err);
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
        console.error("Zip load error:", e);
    }
    return material;
}

const loadedMats = {
    bark1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark1.zip', { roughness: 0.85 }),
    bark2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark2.zip', { roughness: 0.85 }),
    ground: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Ground1.zip', { roughness: 0.9 }),
    grass: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Grass1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 }),
    leaf1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 }),
    leaf2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf2.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 })
};

// ==========================================
// 3. TERRAIN, HILLS, & REALISTIC GRASS
// ==========================================
function getTerrainHeight(x, z) {
    return Math.sin(x * 0.04) * Math.cos(z * 0.04) * 3.5 + Math.sin(x * 0.015) * 6;
}

const terrainGeo = new THREE.PlaneGeometry(250, 250, 60, 60);
terrainGeo.rotateX(-Math.PI / 2);
const posAttr = terrainGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(x, z));
}
terrainGeo.computeVertexNormals();

loadedMats.ground.then((mat) => {
    if (mat.map) mat.map.repeat.set(20, 20);
    const groundMesh = new THREE.Mesh(terrainGeo, mat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
});

// Shorter, more realistic grass blades
const grassBladeGeo = new THREE.PlaneGeometry(0.3, 0.6); 
grassBladeGeo.translate(0, 0.3, 0);

loadedMats.grass.then((mat) => {
    const grassCount = 5000;
    const instancedGrass = new THREE.InstancedMesh(grassBladeGeo, mat, grassCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < grassCount; i++) {
        const x = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        const y = getTerrainHeight(x, z);

        dummy.position.set(x, y, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(1, 0.7 + Math.random() * 0.6, 1);
        dummy.updateMatrix();
        instancedGrass.setMatrixAt(i, dummy.matrix);
    }
    instancedGrass.receiveShadow = true;
    scene.add(instancedGrass);
});

// ==========================================
// 4. WEAPON, AMMO & CRAFTING SYSTEM
// ==========================================
const gunGroup = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.4 }));
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.8 }));
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.02, -0.3);
gunGroup.add(gunBody, gunBarrel);
gunGroup.position.set(0.2, -0.18, -0.35);
camera.add(gunGroup);
scene.add(camera);

const ammoState = { loaded: 5, maxClip: 5, reserve: 20, wood: 0, isScoped: false, isReloading: false };
const projectiles = [];

function shootGun() {
    if (ammoState.isReloading || ammoState.loaded <= 0) {
        if (ammoState.loaded <= 0) reloadGun();
        return;
    }

    ammoState.loaded--;
    updateUI();

    gunGroup.position.z += 0.05;
    setTimeout(() => gunGroup.position.z -= 0.05, 50);

    const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.035), new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
    const pos = new THREE.Vector3();
    gunBarrel.getWorldPosition(pos);
    bullet.position.copy(pos);

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    bullet.userData = { velocity: dir.multiplyScalar(3.2), life: 35 };

    scene.add(bullet);
    projectiles.push(bullet);
}

function reloadGun() {
    if (ammoState.isReloading || ammoState.loaded === ammoState.maxClip || ammoState.reserve <= 0) return;
    ammoState.isReloading = true;
    updateUI("Reloading...");

    setTimeout(() => {
        const needed = ammoState.maxClip - ammoState.loaded;
        const available = Math.min(needed, ammoState.reserve);
        ammoState.loaded += available;
        ammoState.reserve -= available;
        ammoState.isReloading = false;
        updateUI();
    }, 1000);
}

function craftAmmo() {
    if (ammoState.wood >= 2) {
        ammoState.wood -= 2;
        ammoState.reserve += 5;
        updateUI("Crafted +5 Ammo!");
    } else {
        updateUI("Need 2 Wood!");
    }
}

// ==========================================
// 5. REALISTIC DINOSAURS (COLLAPSING ANIMATION)
// ==========================================
const dinosaurs = [];
const dinoMat = new THREE.MeshStandardMaterial({ color: 0x334d3d, roughness: 0.6, metalness: 0.1 });

for (let i = 0; i < 5; i++) {
    const dinoGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.6, 4, 8), dinoMat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 1.0;
    body.castShadow = true;
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.7), dinoMat);
    head.position.set(1.1, 1.3, 0);
    head.castShadow = true;

    dinoGroup.add(body, head);
    const x = (Math.random() - 0.5) * 70;
    const z = -20 - Math.random() * 50;
    dinoGroup.position.set(x, getTerrainHeight(x, z), z);
    dinoGroup.userData = { health: 3, isFalling: false, fallProgress: 0 };
    
    scene.add(dinoGroup);
    dinosaurs.push(dinoGroup);
}

function updateDinosaurs() {
    for (let dino of dinosaurs) {
        if (dino.userData.isFalling) {
            dino.userData.fallProgress += 0.08;
            dino.rotation.z = Math.min(Math.PI / 2, dino.userData.fallProgress);
            if (dino.userData.fallProgress >= Math.PI / 2) {
                setTimeout(() => {
                    const nx = (Math.random() - 0.5) * 80;
                    const nz = -20 - Math.random() * 60;
                    dino.position.set(nx, getTerrainHeight(nx, nz), nz);
                    dino.rotation.z = 0;
                    dino.userData.health = 3;
                    dino.userData.isFalling = false;
                    dino.userData.fallProgress = 0;
                }, 1200);
            }
        }
    }
}

// ==========================================
// 6. MOBILE TOUCH CONTROLS (SPLIT SCREEN ZONES)
// ==========================================
const ui = document.createElement('div');
ui.innerHTML = `
    <style>
        #hud { position: absolute; top: 15px; left: 15px; color: white; font-family: monospace; font-size: 15px; background: rgba(0,0,0,0.6); padding: 10px; border-radius: 8px; pointer-events: none; }
        #joystick-zone { position: absolute; bottom: 25px; left: 25px; width: 120px; height: 120px; background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.4); border-radius: 50%; touch-action: none; }
        #joystick-knob { position: absolute; top: 35px; left: 35px; width: 50px; height: 50px; background: rgba(255,255,255,0.6); border-radius: 50%; pointer-events: none; }
        .btn { position: absolute; background: rgba(0,0,0,0.6); color: white; border: 1.5px solid white; border-radius: 8px; font-family: sans-serif; font-size: 13px; font-weight: bold; text-align: center; user-select: none; touch-action: manipulation; }
        #shoot-btn { bottom: 35px; right: 25px; width: 75px; height: 75px; border-radius: 50%; background: rgba(220,40,40,0.8); line-height: 75px; }
        #scope-btn { bottom: 125px; right: 35px; width: 55px; height: 55px; border-radius: 50%; line-height: 55px; }
        #reload-btn { bottom: 35px; right: 115px; width: 55px; height: 55px; border-radius: 50%; line-height: 55px; }
        #sprint-btn { bottom: 190px; right: 35px; width: 55px; height: 40px; line-height: 40px; }
        #fly-toggle { top: 15px; right: 15px; width: 80px; height: 35px; line-height: 35px; }
        #fly-up { top: 60px; right: 15px; width: 40px; height: 40px; line-height: 40px; display: none; }
        #fly-down { top: 105px; right: 15px; width: 40px; height: 40px; line-height: 40px; display: none; }
        #light-btn { top: 155px; right: 15px; width: 80px; height: 35px; line-height: 35px; }
        #craft-btn { top: 200px; right: 15px; width: 80px; height: 35px; line-height: 35px; background: rgba(40,160,60,0.8); }
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
    hud.innerHTML = status || `AMMO: ${ammoState.loaded} / ${ammoState.reserve}<br>WOOD: ${ammoState.wood}`;
}

const player = { moveFwd: 0, moveRight: 0, yaw: 0, pitch: 0, isSprinting: false, isFlying: false, flyVel: 0 };

// Joystick Touch Handlers (Left Side Only)
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

// Right Screen Drag for Camera Looking (Independent of Joystick)
let lookTouchId = null, lastX = 0, lastY = 0;
window.addEventListener('touchstart', (e) => {
    for (let t of e.changedTouches) {
        if (t.clientX > window.innerWidth / 2 && lookTouchId === null && !e.target.classList.contains('btn')) {
            lookTouchId = t.identifier;
            lastX = t.clientX;
            lastY = t.clientY;
        }
    }
});
window.addEventListener('touchmove', (e) => {
    for (let t of e.changedTouches) {
        if (t.identifier === lookTouchId) {
            const dx = t.clientX - lastX;
            const dy = t.clientY - lastY;
            lastX = t.clientX;
            lastY = t.clientY;
            const sens = ammoState.isScoped ? 0.0015 : 0.004;
            player.yaw -= dx * sens;
            player.pitch -= dy * sens;
            player.pitch = Math.max(-Math.PI / 2.4, Math.min(Math.PI / 2.4, player.pitch));
            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.x = player.pitch;
            euler.y = player.yaw;
            camera.quaternion.setFromEuler(euler);
        }
    }
});
window.addEventListener('touchend', (e) => {
    for (let t of e.changedTouches) {
        if (t.identifier === lookTouchId) lookTouchId = null;
    }
});

// UI Button Event Bindings
document.getElementById('shoot-btn').addEventListener('click', shootGun);
document.getElementById('reload-btn').addEventListener('click', reloadGun);
document.getElementById('craft-btn').addEventListener('click', craftAmmo);
document.getElementById('light-btn').addEventListener('click', () => flashlight.visible = !flashlight.visible);
document.getElementById('scope-btn').addEventListener('click', () => {
    ammoState.isScoped = !ammoState.isScoped;
    camera.fov = ammoState.isScoped ? 30 : 75;
    camera.updateProjectionMatrix();
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
// 7. MAIN GAME LOOP
// ==========================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    updateDayNight(delta);
    updateDinosaurs();

    // Movement Calculation
    const speed = player.isFlying ? 0.35 : (player.isSprinting ? 0.25 : 0.1);
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
        camera.position.y = getTerrainHeight(camera.position.x, camera.position.z) + 2.0;
    }

    // Projectile Updates & Collisions
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const b = projectiles[i];
        b.position.add(b.userData.velocity);
        b.userData.life--;

        for (let dino of dinosaurs) {
            if (!dino.userData.isFalling && b.position.distanceTo(dino.position) < 1.6) {
                dino.userData.health--;
                b.userData.life = 0;
                if (dino.userData.health <= 0) {
                    dino.userData.isFalling = true;
                    ammoState.wood++;
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
