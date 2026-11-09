import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import JSZip from 'jszip';

// ==========================================
// 1. SCENE, CAMERA, & RENDERER SETUP
// ==========================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Ambient & Directional Lighting
const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(20, 40, 20);
sunLight.castShadow = true;
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// ==========================================
// 2. EXR SKY & PBR TEXTURE PIPELINE
// ==========================================
const exrLoader = new EXRLoader();
exrLoader.load('https://filebin.net/cs85jyze29af9ebj/je_gray_02_4k.exr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
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
    } catch (error) {
        console.error("Error loading zip asset:", zipUrl, error);
    }
    return material;
}

const materials = {
    bark1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark1.zip', { roughness: 0.8 }),
    bark2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Bark2.zip', { roughness: 0.8 }),
    ground: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Ground1.zip', { roughness: 0.9 }),
    grass: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Grass1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    leaf1: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf1.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    leaf2: loadMaterialFromZip('https://filebin.net/cs85jyze29af9ebj/Leaf2.zip', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 })
};

// Apply Ground Terrain
materials.ground.then((mat) => {
    if (mat.map) mat.map.repeat.set(20, 20);
    const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat);
    groundMesh.rotation.x = -Math.PI / 2;
    scene.add(groundMesh);
});

// ==========================================
// 3. GUN & SHOOTING SYSTEM
// ==========================================
const gunGroup = new THREE.Group();

// Simple procedural rifle mesh attached to camera
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 }));
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 }));
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.02, -0.5);

gunGroup.add(gunBody, gunBarrel);
gunGroup.position.set(0.3, -0.25, -0.5); // Hold down in bottom-right view
camera.add(gunGroup);
scene.add(camera);

// Shooting Logic via Raycasting
const raycaster = new THREE.Raycaster();
const projectiles = [];

function shootGun() {
    // Recoil animation
    gunGroup.position.z += 0.08;
    setTimeout(() => gunGroup.position.z -= 0.08, 80);

    // Create laser beam bullet visualization
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.05), bulletMat);
    
    // Spawn at gun tip
    const gunWorldPos = new THREE.Vector3();
    gunBarrel.getWorldPosition(gunWorldPos);
    bullet.position.copy(gunWorldPos);

    // Calculate shoot direction
    const shootDir = new THREE.Vector3();
    camera.getWorldDirection(shootDir);
    bullet.userData = { velocity: shootDir.multiplyScalar(2.0), life: 60 };

    scene.add(bullet);
    projectiles.push(bullet);

    // Check hit target
    raycaster.set(camera.position, shootDir);
}

// ==========================================
// 4. PLAYER MOVEMENT & CONTROLS (WALK, SPRINT, FLY)
// ==========================================
const playerState = {
    moveForward: 0,
    moveRight: 0,
    isSprinting: false,
    isFlying: false,
    flyVertical: 0, // 1 for up, -1 for down
    yaw: 0,
    pitch: 0
};

const walkSpeed = 0.15;
const sprintSpeed = 0.35;
const flySpeed = 0.4;
const playerHeight = 2.0;

// Update Loop for Movement
function updatePlayerMovement() {
    const currentSpeed = playerState.isFlying 
        ? flySpeed 
        : (playerState.isSprinting ? sprintSpeed : walkSpeed);

    // Calculate movement directions based on camera orientation
    const frontDir = new THREE.Vector3();
    camera.getWorldDirection(frontDir);
    
    if (!playerState.isFlying) frontDir.y = 0; // Lock to ground when walking/sprinting
    frontDir.normalize();

    const sideDir = new THREE.Vector3();
    sideDir.crossVectors(frontDir, new THREE.Vector3(0, 1, 0)).normalize();

    // Apply translation
    if (playerState.moveForward !== 0) {
        camera.position.addScaledVector(frontDir, playerState.moveForward * currentSpeed);
    }
    if (playerState.moveRight !== 0) {
        camera.position.addScaledVector(sideDir, playerState.moveRight * currentSpeed);
    }

    // Flying vertical controls
    if (playerState.isFlying) {
        camera.position.y += playerState.flyVertical * currentSpeed;
    } else {
        // Keep grounded
        camera.position.y = playerHeight;
    }
}

// Update Bullet Trajectories
function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const bullet = projectiles[i];
        bullet.position.add(bullet.userData.velocity);
        bullet.userData.life--;

        if (bullet.userData.life <= 0) {
            scene.remove(bullet);
            projectiles.splice(i, 1);
        }
    }
}

// ==========================================
// 5. KEYBOARD INPUTS (FOR DESKTOP TESTING)
// ==========================================
window.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'KeyW': playerState.moveForward = 1; break;
        case 'KeyS': playerState.moveForward = -1; break;
        case 'KeyA': playerState.moveRight = -1; break;
        case 'KeyD': playerState.moveRight = 1; break;
        case 'ShiftLeft': playerState.isSprinting = true; break;
        case 'KeyF': playerState.isFlying = !playerState.isFlying; break; // Toggle Fly Mode
        case 'Space': if (playerState.isFlying) playerState.flyVertical = 1; break;
        case 'ControlLeft': if (playerState.isFlying) playerState.flyVertical = -1; break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': case 'KeyS': playerState.moveForward = 0; break;
        case 'KeyA': case 'KeyD': playerState.moveRight = 0; break;
        case 'ShiftLeft': playerState.isSprinting = false; break;
        case 'Space': case 'ControlLeft': playerState.flyVertical = 0; break;
    }
});

window.addEventListener('mousedown', () => shootGun());

// Mouse Look / Pointer Lock
window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        playerState.yaw -= e.movementX * 0.002;
        playerState.pitch -= e.movementY * 0.002;
        playerState.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, playerState.pitch));

        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.x = playerState.pitch;
        euler.y = playerState.yaw;
        camera.quaternion.setFromEuler(euler);
    }
});

document.body.addEventListener('click', () => document.body.requestPointerLock());

// ==========================================
// 6. MAIN GAME LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    updatePlayerMovement();
    updateProjectiles();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
