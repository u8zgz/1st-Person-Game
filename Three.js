const releaseBaseUrl = "https://github.com/u8zgz/1st-Person-Game/releases/download/textures-v1/";

// Asset checksums & filenames from your release:
// 1. Bark1.zip (sha256:4cc5e3d0469dc01e1e68bcaff045db158417b437d4af13cecb98e706d9e96440)
// 2. Bark2.zip (sha256:4f08e4f6c0b4fd7d10e42...)
// 3. Grass1.zip (sha256:66666446a938225f8c1fd...)
// 4. Ground1.zip (sha256:4195fcdc3fa986e4589eb...)
// 5. je_gray_02_4k.exr (sha256:d86f25d6530c927ce2f67...)
// 6. Leaf1.zip (sha256:cb47e1760c9a9826caf5c...)
// 7. Leaf2.zip (sha256:82e362d16fb94421a935b...)

const totalAssets = 7;
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

// 1. Load EXR Sky Map
const exrLoader = new THREE.EXRLoader();
exrLoader.load(releaseBaseUrl + 'je_gray_02_4k.exr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    updateProgress();
}, undefined, () => {
    console.warn("EXR fallback active");
    updateProgress();
});

// 2. Load Zip Archives via JSZip
async function loadMaterialFromGitHubZip(fileName, matKey, options = {}) {
    const mat = new THREE.MeshStandardMaterial(options);
    try {
        const res = await fetch(releaseBaseUrl + fileName);
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
        pbrMaterials[matKey] = mat;
    } catch (e) {
        console.error("Zip load error for", matKey, e);
        pbrMaterials[matKey] = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    }
    updateProgress();
}

// Trigger all 6 ZIP fetches from GitHub Release
loadMaterialFromGitHubZip('Ground1.zip', 'ground', { roughness: 0.9 });
loadMaterialFromGitHubZip('Bark1.zip', 'bark1', { roughness: 0.8 });
loadMaterialFromGitHubZip('Bark2.zip', 'bark2', { roughness: 0.8 });
loadMaterialFromGitHubZip('Grass1.zip', 'grass', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 });
loadMaterialFromGitHubZip('Leaf1.zip', 'leaf1', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 });
loadMaterialFromGitHubZip('Leaf2.zip', 'leaf2', { side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 });
