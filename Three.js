// Exact direct download links for all 7 release assets
const assetFiles = [
    { type: 'exr', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/je_gray_02_4k.exr' },
    { type: 'zip', key: 'ground', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Ground1.zip', opts: { roughness: 0.9 } },
    { type: 'zip', key: 'bark1', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Bark1.zip', opts: { roughness: 0.8 } },
    { type: 'zip', key: 'bark2', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Bark2.zip', opts: { roughness: 0.8 } },
    { type: 'zip', key: 'grass', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Grass1.zip', opts: { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 } },
    { type: 'zip', key: 'leaf1', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Leaf1.zip', opts: { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 } },
    { type: 'zip', key: 'leaf2', url: 'https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/Leaf2.zip', opts: { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 } }
];

const totalAssets = assetFiles.length;
let loadedCount = 0;

const loadingBar = document.getElementById('loading-bar');
const loadingStatus = document.getElementById('loading-status');
const startBtn = document.getElementById('start-btn');

function updateProgress() {
    loadedCount++;
    const percent = Math.floor((loadedCount / totalAssets) * 100);
    loadingBar.style.width = percent + '%';
    loadingStatus.innerText = `Loading Assets: ${percent}% (${loadedCount}/${totalAssets})`;

    if (loadedCount >= totalAssets) {
        loadingStatus.innerText = 'All Assets Loaded Successfully!';
        startBtn.style.display = 'block';
    }
}

const pbrMaterials = {};

async function loadAllAssets() {
    for (const asset of assetFiles) {
        if (asset.type === 'exr') {
            const exrLoader = new THREE.EXRLoader();
            exrLoader.load(
                asset.url,
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    scene.background = texture;
                    scene.environment = texture;
                    updateProgress();
                },
                undefined,
                (err) => {
                    console.warn("EXR Sky load failed, fallback active:", err);
                    updateProgress();
                }
            );
        } else if (asset.type === 'zip') {
            const mat = new THREE.MeshStandardMaterial(asset.opts);
            try {
                const res = await fetch(asset.url);
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                const blob = await res.blob();
                const zip = await JSZip.loadAsync(blob);

                for (const [filename, file] of Object.entries(zip.files)) {
                    if (!file.dir && /\.(jpg|jpeg|png)$/i.test(filename)) {
                        const fileBlob = await file.async('blob');
                        const url = URL.createObjectURL(fileBlob);
                        const texture = new THREE.TextureLoader().load(url);
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;

                        if (/color|diffuse|albedo|basecolor/i.test(filename)) {
                            texture.encoding = THREE.sRGBEncoding;
                            mat.map = texture;
                        } else if (/normal|nrm/i.test(filename)) {
                            mat.normalMap = texture;
                        } else if (/rough|rgh/i.test(filename)) {
                            mat.roughnessMap = texture;
                        } else if (/alpha|trans|opacity|mask/i.test(filename)) {
                            mat.alphaMap = texture;
                            mat.transparent = true;
                        }
                    }
                }
                mat.needsUpdate = true;
                pbrMaterials[asset.key] = mat;
            } catch (e) {
                console.error("Zip load error for " + asset.key, e);
                pbrMaterials[asset.key] = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
            }
            updateProgress();
        }
    }
}

// Start loading all assets
loadAllAssets();
