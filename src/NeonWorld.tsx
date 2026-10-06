import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { WorldSceneProps } from './worlds';

const LAP = 2400;
const TAU = Math.PI * 2;
const route = (z: number) => ({ x: Math.sin(z / LAP * TAU) * 64 + Math.sin(z / LAP * TAU * 3) * 17, y: 12 + Math.sin(z / LAP * TAU * 2) * 6 });
// Every 300 m the two causeways share a junction; the reactor tunnel is a common spine.
const fork = (z: number) => {
  const u = ((-z % LAP) + LAP) % LAP;
  const tunnelClearance = 1 - THREE.MathUtils.smoothstep(u, 710, 800) + THREE.MathUtils.smoothstep(u, 1260, 1370);
  return Math.sin(z / 300 * Math.PI) ** 2 * tunnelClearance;
};
const branchRoute = (z: number, branch: number) => {
  const p = route(z), split = fork(z);
  return { x: p.x + branch * split * 26, y: p.y + Math.max(0, branch) * split * 7 };
};
const branchHeading = (z: number, branch: number) => Math.atan2(branchRoute(z + 0.2, branch).x - branchRoute(z, branch).x, 0.2);
const heading = (z: number) => Math.atan2(route(z + 0.2).x - route(z).x, 0.2);
const random = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** A procedural, continuous anti-gravity circuit: city, reactor tunnel and orbital bridge. */
export default function NeonWorld(props: WorldSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [failed, setFailed] = useState(false);
  const [district, setDistrict] = useState('01 / NOVA CITY');

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let renderer: THREE.WebGPURenderer | undefined;
    let pipeline: THREE.RenderPipeline | undefined;
    let scenePass: ReturnType<typeof pass> | undefined;
    let bloomPass: ReturnType<typeof bloom> | undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#363e78');
    scene.fog = new THREE.Fog('#536393', 170, 1120);
    const camera = new THREE.PerspectiveCamera(64, 1, 0.15, 3200);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const geometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
    const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const value = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.25, ...extra });
      materials.add(value); return value;
    };
    const lightMaterial = (color: string, opacity = 1) => {
      const value = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
      value.color.multiplyScalar(1.8);
      materials.add(value); return value;
    };
    const mesh = (shape: THREE.BufferGeometry, skin: THREE.Material, parent: THREE.Object3D = scene) => {
      const value = new THREE.Mesh(shape, skin); parent.add(value); return value;
    };
    const cyan = lightMaterial('#68f9ff');
    const pink = lightMaterial('#ff69d9');
    const amber = lightMaterial('#ffc58b');
    const white = lightMaterial('#e2fcff');
    const roadMaterial = material('#1b3158', { metalness: 0.55, roughness: 0.36 });
    const armor = material('#9bb8d9', { metalness: 0.7, roughness: 0.33 });
    const dark = material('#162b4b');
    const cube = geometry(new THREE.BoxGeometry(1, 1, 1));
    const dummy = new THREE.Object3D();
    scene.add(new THREE.HemisphereLight('#b8d8ff', '#7f5085', 3.4));
    const sun = new THREE.DirectionalLight('#ffc9b1', 4.0);
    sun.position.set(-240, 280, -250); scene.add(sun);

    // Vertex-coloured sky stays luminous on WebGPU and its WebGL2 fallback.
    const skyGeo = geometry(new THREE.SphereGeometry(2700, 32, 24));
    const skyPositions = skyGeo.getAttribute('position');
    const skyColors: number[] = [];
    for (let i = 0; i < skyPositions.count; i++) {
      const elevation = skyPositions.getY(i) / 2700;
      const c = new THREE.Color('#dba5bd').lerp(new THREE.Color('#253c7d'), THREE.MathUtils.clamp((elevation + 0.05) * 2.6, 0, 1));
      if (elevation < 0) c.lerp(new THREE.Color('#52629c'), Math.min(1, -elevation * 4));
      skyColors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    const skyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    materials.add(skyMaterial);
    const sky = mesh(skyGeo, skyMaterial);
    const planetMaterial = material('#a6ceec', { emissive: '#31518c', emissiveIntensity: 0.35, roughness: 1, fog: false });
    const planet = mesh(geometry(new THREE.SphereGeometry(230, 48, 32)), planetMaterial);
    const planetRingMaterial = new THREE.MeshBasicMaterial({ color: '#fbd7c4', side: THREE.DoubleSide, transparent: true, opacity: 0.48, fog: false });
    materials.add(planetRingMaterial);
    const planetRing = mesh(geometry(new THREE.RingGeometry(290, 380, 96)), planetRingMaterial, planet);
    planetRing.rotation.set(1.04, 0.42, 0.35);
    const innerRing = mesh(geometry(new THREE.RingGeometry(270, 279, 96)), white, planet);
    innerRing.rotation.copy(planetRing.rotation);

    const horizon = mesh(geometry(new THREE.PlaneGeometry(7000, 8000)), material('#496fa1', { roughness: 0.25, metalness: 0.6 }));
    horizon.rotation.x = -Math.PI / 2; horizon.position.y = -69;

    function ribbon(offset: number, width: number, height: number, skin: THREE.Material, branch = 0) {
      const positions: number[] = [], indices: number[] = [];
      for (let i = 0; i <= 2160; i++) {
        const z = -4800 + i * 10 / 3;
        const p = branchRoute(z, branch);
        positions.push(p.x + offset - width / 2, p.y + height, z, p.x + offset + width / 2, p.y + height, z);
        if (i < 2160) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const shape = geometry(new THREE.BufferGeometry());
      shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      shape.setIndex(indices); shape.computeVertexNormals(); mesh(shape, skin);
    }
    ribbon(0, 15.5, -0.55, armor);
    ribbon(0, 14, 0, roadMaterial);
    ribbon(-6.8, 0.16, 0.06, cyan); ribbon(6.8, 0.16, 0.06, pink);
    ribbon(-7.6, 0.2, 0.15, cyan); ribbon(7.6, 0.2, 0.15, pink);
    ribbon(-2.15, 0.055, 0.025, armor); ribbon(2.15, 0.055, 0.025, armor);

    const restorationLight = lightMaterial('#78ffc2');
    const discoveryLight = lightMaterial('#ffc98b');
    const branches = new THREE.Group(); scene.add(branches);
    const firstBranchChild = scene.children.length;
    for (const side of [-1, 1]) {
      ribbon(0, 8.8, -0.3, armor, side);
      ribbon(0, 8.1, 0.09, roadMaterial, side);
      ribbon(-3.9, 0.16, 0.14, side < 0 ? restorationLight : discoveryLight, side);
      ribbon(3.9, 0.16, 0.14, side < 0 ? restorationLight : discoveryLight, side);
    }
    // Preserve the original circuit for integrations that do not provide an expedition.
    for (const child of scene.children.slice(firstBranchChild)) branches.add(child);

    // One draw call per structural family, even with the three copies needed for a seamless loop.
    function instances(count: number, skin: THREE.Material, shape: THREE.BufferGeometry = cube) {
      const value = new THREE.InstancedMesh(shape, skin, count); scene.add(value); return value;
    }
    function place(batch: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = 0) {
      dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, rotation, 0); dummy.updateMatrix(); batch.setMatrixAt(index, dummy.matrix);
    }
    const towers = instances(486, material('#365075', { roughness: 0.42, metalness: 0.48 }));
    const towerLedges = instances(486 * 4, armor);
    const windowMaterial = lightMaterial('#7fe8ff');
    const windows = instances(486 * 12, windowMaterial);
    const roofBeacons = instances(486, pink);
    let ti = 0;
    for (const shift of [-LAP, 0, LAP]) {
      const rand = random(8972);
      for (let i = 0; i < 162; i++) {
        const u = rand() * 1020 - 140;
        const z = -u + shift;
        const side = i % 2 ? 1 : -1;
        // Reserve the complete fork envelope, including tower depth on bends.
        const x = route(z).x + side * (48 + rand() * 250);
        const h = 25 + rand() ** 1.4 * 154;
        const w = 10 + rand() * 18;
        const depth = 12 + rand() * 19;
        const base = -66;
        place(towers, ti, x, base + h / 2, z, w, h, depth);
        place(roofBeacons, ti, x, base + h + 0.7, z, w + 0.6, 0.4, depth + 0.6);
        for (let j = 0; j < 4; j++) place(towerLedges, ti * 4 + j, x, base + h * (j + 1) / 4, z, w + 0.8, 0.55, depth + 0.8);
        for (let j = 0; j < 12; j++) {
          const wy = base + 6 + (h - 10) * j / 12;
          place(windows, ti * 12 + j, x, wy, z + depth / 2 + 0.04, w * (j % 3 === 0 ? 0.42 : 0.85), 0.5 + rand() * 0.6, 0.1);
        }
        ti++;
      }
    }
    const laneMarkers = instances(720 * 2, cyan);
    const railPosts = instances(360 * 2, armor);
    const supports = instances(90, dark);
    for (let i = 0; i < 720; i++) {
      const z = -4795 + i * 10; const p = route(z);
      for (let s = 0; s < 2; s++) place(laneMarkers, i * 2 + s, p.x + (s ? 5.5 : -5.5), p.y + 0.05, z, 0.33, 0.06, 2.7, heading(z));
    }
    for (let i = 0; i < 360; i++) {
      const z = -4790 + i * 20; const p = route(z);
      for (let s = 0; s < 2; s++) place(railPosts, i * 2 + s, p.x + (s ? 7.6 : -7.6), p.y + 0.55, z, 0.22, 1.15, 0.5, heading(z));
    }
    for (let i = 0; i < 90; i++) {
      const z = -4790 + i * 80; const p = route(z);
      place(supports, i, p.x, (p.y - 66) / 2, z, 2.8, p.y + 66, 4.5);
    }

    const archShape = geometry(new THREE.TorusGeometry(10.4, 0.17, 6, 6, Math.PI));
    const tunnelRibShape = geometry(new THREE.TorusGeometry(12.7, 0.6, 6, 8, Math.PI));
    const arches = instances(72, cyan, archShape);
    const archFoot = instances(144, armor);
    const tunnelRibs = instances(81, armor, tunnelRibShape);
    const tunnelLights = instances(81, pink, archShape);
    let ai = 0, ri = 0;
    for (const shift of [-LAP, 0, LAP]) {
      for (let i = 0; i < 24; i++) {
        const z = -80 - i * 100 + shift; const p = route(z);
        place(arches, ai, p.x, p.y + 2.1, z, 0.8, 0.9, 1, heading(z));
        for (let s = 0; s < 2; s++) place(archFoot, ai * 2 + s, p.x + (s ? 8.35 : -8.35), p.y + 1.0, z, 0.4, 2, 0.8);
        ai++;
      }
      for (let i = 0; i < 27; i++) {
        const z = -820 - i * 16 + shift; const p = route(z);
        place(tunnelRibs, ri, p.x, p.y, z, 1, 1, 1, heading(z));
        place(tunnelLights, ri, p.x, p.y + 0.2, z - 0.75, 1.13, 1.13, 1, heading(z));
        ri++;
      }
      // Faceted continuous tunnel roof, open at each end; the road stays visible throughout.
      const tunnelPositions: number[] = [], tunnelIndices: number[] = [];
      for (let row = 0; row <= 84; row++) {
        const z = -812 - row * 5.2 + shift; const p = route(z);
        for (let segment = 0; segment <= 8; segment++) {
          const angle = segment / 8 * Math.PI;
          tunnelPositions.push(p.x + Math.cos(angle) * 13.1, p.y + Math.sin(angle) * 13.1, z);
          if (row < 84 && segment < 8) {
            const k = row * 9 + segment;
            tunnelIndices.push(k, k + 1, k + 9, k + 1, k + 10, k + 9);
          }
        }
      }
      const shell = geometry(new THREE.BufferGeometry());
      shell.setAttribute('position', new THREE.Float32BufferAttribute(tunnelPositions, 3)); shell.setIndex(tunnelIndices); shell.computeVertexNormals();
      mesh(shell, material('#24355e', { side: THREE.DoubleSide, emissive: '#172e55', emissiveIntensity: 0.6 }));
      // Orbital bridge: enormous skeletal rings frame the planet above an open cloud sea.
      for (let i = 0; i < 6; i++) {
        const z = -1350 - i * 135 + shift; const p = route(z);
        const halo = mesh(geometry(new THREE.TorusGeometry(39, 0.65, 6, 8)), armor);
        halo.position.set(p.x, p.y + 22, z); halo.rotation.y = heading(z);
        const trim = mesh(geometry(new THREE.TorusGeometry(38.1, 0.13, 5, 8)), i % 2 ? amber : cyan, halo);
        trim.position.z = 0.75;
        for (const side of [-1, 1]) {
          const buttress = mesh(cube, armor); buttress.position.set(p.x + side * 22, p.y - 12, z); buttress.scale.set(2, 46, 4); buttress.rotation.z = side * -0.65;
        }
      }
    }

    // The campaign physically rebuilds the city. Each restored block has a foundation,
    // a rising inhabited tower, and a powered bridge over the restoration causeway.
    const campaign = new THREE.Group(); scene.add(campaign);
    const rebuilt: { structure: THREE.Group; light: THREE.Group; index: number }[] = [];
    const relays: { object: THREE.Group; energy: THREE.Group; halo: THREE.Mesh; index: number }[] = [];
    const reactorSkin = material('#375a6b', { metalness: 0.75, roughness: 0.28 });
    const relicSkin = material('#88678a', { metalness: 0.7, roughness: 0.3 });
    const relayShape = geometry(new THREE.OctahedronGeometry(5.2));
    const relayRing = geometry(new THREE.TorusGeometry(10, 0.18, 5, 28));
    for (const shift of [-LAP, 0, LAP]) {
      for (let i = 0; i < 12; i++) {
        const landmarkZ = -75 - i * 190 + shift;
        const p = branchRoute(landmarkZ, -1);
        const district = new THREE.Group(); campaign.add(district);
        district.position.set(p.x - 17, p.y, landmarkZ);
        const foundation = mesh(cube, dark, district); foundation.scale.set(14, 7, 18); foundation.position.y = -3.5;
        const structure = new THREE.Group(); district.add(structure);
        const tower = mesh(cube, reactorSkin, structure); tower.scale.set(12, 36 + i % 3 * 9, 14); tower.position.y = tower.scale.y / 2;
        const light = new THREE.Group(); structure.add(light);
        for (const side of [-1, 1]) {
          const seam = mesh(cube, restorationLight, light); seam.position.set(side * 5.9, 23, 7.1); seam.scale.set(0.22, 44, 0.12);
        }
        for (let level = 0; level < 5; level++) {
          const band = mesh(cube, restorationLight, light); band.position.set(0, 5 + level * 8, 7.2); band.scale.set(11, 0.6, 0.15);
        }
        const bridge = mesh(cube, armor, structure); bridge.position.set(12, 14, 0); bridge.scale.set(36, 1.6, 5);
        const trim = mesh(cube, restorationLight, light); trim.position.set(12, 14.9, 2.6); trim.scale.set(36, 0.18, 0.15);
        const pier = mesh(cube, reactorSkin, structure); pier.position.set(30, 5, 0); pier.scale.set(2, 19, 4);
        rebuilt.push({ structure, light, index: i });
      }
      for (let i = 0; i < 6; i++) {
        const landmarkZ = -150 - i * 380 + shift, p = branchRoute(landmarkZ, 1);
        const object = new THREE.Group(); object.position.set(p.x + 24, p.y + 22, landmarkZ); campaign.add(object);
        const relic = mesh(relayShape, relicSkin, object); relic.scale.set(1, 2.1, 1);
        const energy = new THREE.Group(); object.add(energy);
        const halo = mesh(relayRing, discoveryLight, energy); halo.rotation.x = 0.45;
        const second = mesh(relayRing, discoveryLight, energy); second.rotation.y = Math.PI / 2;
        const beam = mesh(cube, discoveryLight, energy); beam.position.y = -19; beam.scale.set(0.16, 35, 0.16);
        relays.push({ object, energy, halo, index: i });
      }
    }

    // Mission target moves from the skyline to the causeway as charge builds.
    // The two gate halves open on completion and reveal the energized reactor core.
    const missionGate = new THREE.Group(); scene.add(missionGate);
    const targetLight = lightMaterial('#78ffc2');
    const gateHalves: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const half = new THREE.Group(); missionGate.add(half); gateHalves.push(half);
      const column = mesh(cube, armor, half); column.position.set(side * 9, 8, 0); column.scale.set(2.2, 17, 3);
      const seam = mesh(cube, targetLight, half); seam.position.set(side * 7.8, 8, 1.6); seam.scale.set(0.3, 16, 0.2);
      const crown = mesh(cube, armor, half); crown.position.set(side * 4.5, 17, 0); crown.scale.set(9, 2, 3);
      const crownTrim = mesh(cube, targetLight, half); crownTrim.position.set(side * 4.5, 15.9, 1.55); crownTrim.scale.set(9, 0.2, 0.15);
    }
    const core = mesh(geometry(new THREE.IcosahedronGeometry(3.8, 1)), targetLight, missionGate); core.position.y = 24;
    const coreHalo = mesh(geometry(new THREE.TorusGeometry(6.3, 0.16, 6, 48)), targetLight, missionGate); coreHalo.position.y = 24;
    const chargeCells: THREE.Mesh[] = [];
    for (let i = 0; i < 12; i++) {
      const cell = mesh(cube, targetLight, missionGate); cell.position.set(-7.7 + i * 1.4, 19.4, 0); cell.scale.set(0.9, 1.1, 1); chargeCells.push(cell);
    }
    const pulseSkin = lightMaterial('#b9ffe0', 0.7);
    const pulse = mesh(geometry(new THREE.TorusGeometry(1, 0.035, 5, 64)), pulseSkin); pulse.visible = false;

    // Roadside billboards are textures generated locally, without an asset/network dependency.
    function billboard(title: string, subtitle: string, color: string, u: number) {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#142847'; ctx.fillRect(0, 0, 768, 256);
      ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.strokeRect(4, 4, 760, 248);
      ctx.fillStyle = color; ctx.font = '800 76px sans-serif'; ctx.fillText(title, 35, 116);
      ctx.fillStyle = '#e3f6ff'; ctx.font = '26px monospace'; ctx.fillText(subtitle, 38, 179);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
      const skin = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }); materials.add(skin);
      const shape = geometry(new THREE.PlaneGeometry(25, 8.3));
      for (const shift of [-LAP, 0, LAP]) {
        const z = -u + shift; const p = route(z);
        const sign = mesh(shape, skin); sign.position.set(p.x - 25, p.y + 12, z); sign.rotation.y = -0.2;
      }
    }
    billboard('NOVA CITY', '01 / FIND YOUR FLOW', '#85f9ff', 125);
    billboard('THE REACTOR', '02 / PRECISION IS POWER', '#ff8adc', 745);
    billboard('ORBITAL', '03 / BREATHE. RESET. RISE.', '#ffcc9e', 1320);

    // Player craft: a legible small silhouette with a rider, suspension pods and twin energy trails.
    const bike = new THREE.Group(); scene.add(bike);
    const chassis = mesh(geometry(new THREE.CapsuleGeometry(0.3, 1.5, 4, 10)), armor, bike);
    chassis.rotation.x = Math.PI / 2; chassis.position.set(0, 0.73, 0);
    const visorMaterial = lightMaterial('#8af9ff');
    const shell = material('#eeeeff', { metalness: 0.5, roughness: 0.28 });
    const kit = material('#ddd6ff', { emissive: '#472a76', emissiveIntensity: 0.2 });
    const trails: THREE.Mesh[] = [];
    const thrusters: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const pod = mesh(geometry(new THREE.CapsuleGeometry(0.2, 1.6, 3, 8)), dark, bike);
      pod.rotation.x = Math.PI / 2; pod.position.set(side * 0.63, 0.39, 0.17);
      const podLight = mesh(cube, cyan, bike); podLight.position.set(side * 0.84, 0.4, 0.15); podLight.scale.set(0.055, 0.07, 1.6);
      const exhaust = mesh(geometry(new THREE.ConeGeometry(0.2, 1.5, 8)), cyan, bike);
      exhaust.rotation.x = Math.PI / 2; exhaust.position.set(side * 0.63, 0.39, 1.8); thrusters.push(exhaust);
      const trail = mesh(cube, lightMaterial('#6cf6ff', 0.36), bike);
      trail.position.set(side * 0.63, 0.34, 5); trail.scale.set(0.11, 0.06, 8); trails.push(trail);
      const wing = mesh(cube, shell, bike); wing.position.set(side * 0.55, 0.65, 0.22); wing.scale.set(1.3, 0.13, 0.32); wing.rotation.z = side * 0.15;
    }
    const body = mesh(geometry(new THREE.CapsuleGeometry(0.23, 0.48, 4, 10)), kit, bike);
    body.position.set(0, 1.36, 0.04); body.rotation.x = -0.75;
    const head = mesh(geometry(new THREE.SphereGeometry(0.25, 12, 10)), shell, bike); head.position.set(0, 1.77, -0.41); head.scale.set(0.88, 1, 1.12);
    const visor = mesh(geometry(new THREE.SphereGeometry(0.252, 12, 8, 0, TAU, 0.75, 0.55)), visorMaterial, bike);
    visor.position.copy(head.position); visor.scale.copy(head.scale);
    const limbShape = geometry(new THREE.CylinderGeometry(0.085, 0.09, 1, 7));
    const axis = new THREE.Vector3(0, 1, 0);
    function limb(a: THREE.Vector3, b: THREE.Vector3, skin: THREE.Material) {
      const part = mesh(limbShape, skin, bike); part.position.copy(a).add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a); part.scale.y = d.length(); part.quaternion.setFromUnitVectors(axis, d.normalize());
    }
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      limb(v(s * 0.22, 1.53, -0.15), v(s * 0.35, 1.09, -0.64), kit);
      limb(v(s * 0.16, 1.18, 0.27), v(s * 0.39, 0.73, -0.15), dark);
      limb(v(s * 0.39, 0.73, -0.15), v(s * 0.43, 0.39, 0.24), armor);
    }
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
    const glowContext = glowCanvas.getContext('2d');
    if (glowContext) {
      const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, '#9dffff'); gradient.addColorStop(0.25, '#62eaff99'); gradient.addColorStop(1, '#62eaff00');
      glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 64, 64);
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas); textures.add(glowTexture);
    const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }); materials.add(glowMaterial);
    const underglow = mesh(geometry(new THREE.PlaneGeometry(2, 2)), glowMaterial, bike);
    underglow.rotation.x = -Math.PI / 2; underglow.position.y = 0.06; underglow.scale.set(1.35, 2.7, 1);

    // Personal-best projection is a lightweight hologram, not another simulated opponent.
    const ghost = new THREE.Group(); ghost.visible = false; scene.add(ghost);
    const ghostMaterial = lightMaterial('#7bfff4', 0.28);
    ghostMaterial.blending = THREE.AdditiveBlending;
    const ghostTrim = lightMaterial('#baffff', 0.68);
    const ghostBody = mesh(chassis.geometry, ghostMaterial, ghost);
    ghostBody.rotation.copy(chassis.rotation); ghostBody.position.copy(chassis.position);
    const ghostRider = mesh(body.geometry, ghostMaterial, ghost);
    ghostRider.position.copy(body.position); ghostRider.rotation.copy(body.rotation);
    const ghostHead = mesh(head.geometry, ghostTrim, ghost); ghostHead.position.copy(head.position); ghostHead.scale.copy(head.scale);
    for (const side of [-1, 1]) {
      const pod = mesh(cube, ghostTrim, ghost); pod.position.set(side * 0.6, 0.4, 0.3); pod.scale.set(0.2, 0.13, 2);
      const streak = mesh(cube, ghostMaterial, ghost); streak.position.set(side * 0.6, 0.4, 2.7); streak.scale.set(0.055, 0.04, 3.5);
    }
    const ghostMarker = mesh(geometry(new THREE.TorusGeometry(1.65, 0.025, 5, 40)), ghostTrim, ghost);
    ghostMarker.rotation.x = -Math.PI / 2; ghostMarker.position.y = 0.07;

    // Sparse foreground particles give speed perception without demanding more effort.
    const motes = instances(100, lightMaterial('#c5fcff', 0.6));
    const burst = instances(60, lightMaterial('#fff0bb'));
    const rand = random(4382);
    const particles = Array.from({ length: 100 }, () => ({ x: (rand() - 0.5) * 76, y: 2 + rand() * 24, z: rand() * 250 }));
    const sparks = Array.from({ length: 60 }, () => ({ x: (rand() - 0.5) * 2, y: rand() * 1.7, z: (rand() - 0.5) * 2 }));
    burst.visible = false;
    const look = new THREE.Vector3();
    let travel = Math.max(0, live.current.progress) * 8400;
    let last = 0;
    let clock = 0;
    let burstAge = 10;
    let lastEvent = live.current.game.eventSerial;
    let lastDistrict = '';
    let lastSector = 0;
    let selectedBranch = live.current.expedition?.branch ?? 0;
    let lane = selectedBranch;
    let lastExpeditionEvent = live.current.expedition?.eventSerial ?? 0;
    let revealAge = 10;
    let revealTravel = travel;
    let frozenExpedition = live.current.expedition;
    const burstOrigin = new THREE.Vector3();
    const animate = (time: number) => {
      if (disposed || !renderer) return;
      const dt = last ? Math.min((time - last) / 1000, 0.06) : 0; last = time;
      const state = live.current;
      const speed = Math.max(0, state.speed);
      if (state.running) { travel += speed / 3.6 * dt; const expected=Math.max(0,state.progress)*8400;if(Math.abs(expected-travel)>8)travel+=(expected-travel)*Math.min(1,dt*2); clock += dt; burstAge += dt; }
      const z = 45 - travel % LAP;
      const bikeZ = z - 10;
      if (state.running) frozenExpedition = state.expedition;
      const expedition = frozenExpedition;
      branches.visible = !!expedition; campaign.visible = !!expedition; missionGate.visible = !!expedition;
      if (expedition && state.running) {
        // Route choices take effect at a shared junction, avoiding a jump across the gap.
        if (fork(bikeZ) < 0.13) selectedBranch = expedition.branch;
        lane += (selectedBranch - lane) * Math.min(1, dt * 3);
        revealAge += dt;
        if (expedition.eventSerial !== lastExpeditionEvent) {
          lastExpeditionEvent = expedition.eventSerial;
          revealAge = 0; revealTravel = travel;
          burstAge = 0; burstOrigin.copy(bike.position).y += 3;
        }
      }
      const currentRoute = (at: number) => branchRoute(at, expedition ? lane : 0);
      const currentHeading = (at: number) => branchHeading(at, expedition ? lane : 0);
      const p = currentRoute(bikeZ);
      bike.position.set(p.x, p.y + 0.3 + Math.sin(clock * 3) * 0.065, bikeZ);
      bike.rotation.y = currentHeading(bikeZ);
      bike.rotation.z = THREE.MathUtils.clamp((currentHeading(bikeZ - 15) - currentHeading(bikeZ + 15)) * 2.3, -0.22, 0.22);
      bike.rotation.x = -(currentRoute(bikeZ + 1).y - p.y);
      const delta = state.game.ghostDelta;
      ghost.visible = delta !== undefined && Number.isFinite(delta);
      if (ghost.visible && delta !== undefined) {
        const separation = THREE.MathUtils.clamp(8 + Math.abs(delta) * 0.035, 8, 45);
        const ghostZ = bikeZ + (delta > 0 ? separation : -separation);
        const ghostRoute = currentRoute(ghostZ);
        ghost.position.set(ghostRoute.x + 3.1, ghostRoute.y + 0.32, ghostZ);
        ghost.rotation.y = currentHeading(ghostZ);
        ghost.rotation.x = -(currentRoute(ghostZ + 1).y - ghostRoute.y);
      }
      const charge = THREE.MathUtils.clamp(state.game.charge, 0, 1);
      const work = state.game.phase === 'work';
      const accurate = state.game.quality === 'locked';
      cyan.color.set(accurate ? '#8dffff' : '#5dbce0').multiplyScalar(1.4 + charge * 1.5);
      pink.color.set(work ? '#ff68d4' : '#ba9ffc').multiplyScalar(work ? 2.1 : 1.3);
      windowMaterial.color.set('#7fe8ff').multiplyScalar(0.65 + charge * 1.5 + Math.max(0, 1 - burstAge) * 1.4);
      visorMaterial.color.set(state.zoneColor);
      kit.emissiveIntensity = 0.25 + charge * 0.8;
      for (const trail of trails) {
        const length = state.running ? 2 + charge * 8 + (work ? 2 : 0) : 0.1;
        trail.scale.z = length; trail.position.z = 1.1 + length / 2;
        (trail.material as THREE.MeshBasicMaterial).opacity = state.running ? 0.15 + charge * 0.3 : 0;
      }
      for (const thruster of thrusters) thruster.scale.y = state.running ? 0.3 + speed * 0.018 + charge * 0.8 : 0.15;
      if (state.game.eventSerial !== lastEvent) { lastEvent = state.game.eventSerial; burstAge = 0; burstOrigin.copy(bike.position).y += 1; }
      burst.visible = burstAge < 1.8;
      if (burst.visible) for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i], r = 2 + burstAge * 11, size = Math.max(0.03, 0.15 * (1 - burstAge / 1.8));
        place(burst, i, burstOrigin.x + s.x * r, burstOrigin.y + s.y * r - burstAge * burstAge * 3, burstOrigin.z + s.z * r, size, size, size);
      }
      if (burst.visible) burst.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < particles.length; i++) {
        const t = particles[i]; const local = (t.z - travel * 1.7) % 250;
        const mz = z - ((local + 250) % 250);
        const r = route(mz);
        const visible = work || i < 35;
        place(motes, i, r.x + t.x, r.y + t.y, mz, visible ? 0.045 : 0, 0.045, state.running ? 0.3 + speed * 0.02 : 0.09);
      }
      motes.instanceMatrix.needsUpdate = true;
      if (expedition) {
        const missionCharge = THREE.MathUtils.clamp(expedition.charge, 0, 1);
        const opening = THREE.MathUtils.smoothstep(revealAge, 0, 2.1);
        const celebrating = revealAge < 5;
        const distance = celebrating ? 24 - (travel - revealTravel) : 290 - Math.pow(missionCharge, 0.7) * 264;
        const targetZ = bikeZ - distance, target = currentRoute(targetZ);
        missionGate.position.set(target.x, target.y, targetZ);
        missionGate.rotation.y = currentHeading(targetZ);
        for (let i = 0; i < gateHalves.length; i++) gateHalves[i].position.x = (i ? 1 : -1) * (celebrating ? opening * 8 : 0);
        targetLight.color.set(expedition.route === 'restore' ? '#78ffc2' : '#ffc98b').multiplyScalar(1.2 + missionCharge * 1.8);
        core.rotation.set(clock * 0.16, clock * 0.4, clock * 0.11);
        core.scale.setScalar(0.5 + missionCharge * 0.5 + (celebrating ? opening : 0));
        core.position.y = 24 + (celebrating ? opening * 18 : 0);
        coreHalo.position.y = core.position.y; coreHalo.rotation.z = clock * -0.3;
        coreHalo.scale.setScalar(1 + (celebrating ? opening * 1.5 : 0));
        chargeCells.forEach((cell, i) => { cell.visible = celebrating || i / 12 < missionCharge; });
        pulse.visible = celebrating;
        if (celebrating) {
          pulse.position.set(target.x, target.y + 9, targetZ);
          pulse.scale.setScalar(4 + revealAge * 28); pulseSkin.opacity = Math.max(0, 0.8 - revealAge / 6);
        }
        const restored = [1, 5, 15, 35, 70, 120].filter(cost => expedition.worldRestored >= cost).length;
        const discovered = [1, 4, 10, 24, 48, 80].filter(cost => expedition.worldDiscovered >= cost).length;
        for (const block of rebuilt) {
          const active = Math.floor(block.index / 2) < restored;
          block.structure.visible = active;
          block.structure.scale.y = 1 + restored * 0.07;
          block.light.visible = active;
        }
        for (const relay of relays) {
          relay.energy.visible = relay.index < discovered;
          relay.object.scale.setScalar(relay.index < discovered ? 1 : 0.5);
          relay.halo.rotation.z = clock * 0.13 + relay.index;
        }
        planetRing.rotation.z = 0.35 + Math.min(discovered, 20) * 0.035;
      } else pulse.visible = false;
      const camRoute = currentRoute(z);
      camera.position.set(camRoute.x + 0.6, camRoute.y + 4.8, z);
      const ahead = currentRoute(z - 43); look.set(ahead.x, ahead.y - 6, z - 43); camera.lookAt(look);
      camera.rotateZ(bike.rotation.z * -0.1);
      const desiredFov = 63 + Math.min(speed, 60) * 0.09 + charge * 2;
      if (Math.abs(camera.fov - desiredFov) > 0.02) { camera.fov += (desiredFov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
      sky.position.copy(camera.position);
      planet.position.set(camera.position.x + 520, 280, z - 1700);
      horizon.position.z = z;
      const u = ((-bikeZ % LAP) + LAP) % LAP;
      const sector = u < 810 || u > 2250 ? 0 : u < 1260 ? 1 : 2;
      const label = expedition ? `${expedition.route === 'restore' ? 'NOVA / ENERGILINJEN' : 'ORBITAL / UKJENT SEKTOR'} · ${String(expedition.completed + 1).padStart(2, '0')}` : ['01 / NOVA CITY', '02 / THE REACTOR', '03 / ORBITAL BRIDGE'][sector];
      if (sector !== lastSector) { lastSector = sector; live.current.onSector?.(sector); }
      if (label !== lastDistrict) { lastDistrict = label; setDistrict(label); }
      try { pipeline ? pipeline.render() : renderer.render(scene, camera); } catch (error) { console.error('Neon Rush rendering failed', error); setFailed(true); return; }
      frame = requestAnimationFrame(animate);
    };

    async function initialize() {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.16;
        await renderer.init();
        if (disposed) { renderer.dispose(); return; }
        pipeline = new THREE.RenderPipeline(renderer);
        scenePass = pass(scene, camera);
        const color = scenePass.getTextureNode('output');
        bloomPass = bloom(color, 0.38, 0.4, 1.05);
        bloomPass.setResolutionScale(0.5);
        pipeline.outputNode = color.add(bloomPass);
        const canvas = renderer.domElement;
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        canvas.setAttribute('aria-label', 'Neon Rush: svevesykkel gjennom neonby, reaktortunnel og orbitalbro');
        container!.appendChild(canvas);
        live.current.onRenderer?.((renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2');
        const resize = () => {
          if (!renderer || disposed) return;
          const width = container!.clientWidth || 900, height = container!.clientHeight || 500;
          renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize); observer.observe(container!); resize();
        live.current.onSector?.(0);
        frame = requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) { console.error('Unable to initialize Neon Rush', error); setFailed(true); live.current.onRenderer?.('2D'); }
      }
    }
    void initialize();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); renderer?.domElement.remove();
      pipeline?.dispose(); bloomPass?.dispose(); scenePass?.dispose();
      if (renderer?.hasInitialized()) renderer.dispose();
      scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); scene.clear();
    };
  }, []);

  return <div ref={host} className="ride-scene neon-world" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#455784' }}>
    <div aria-hidden="true" className="world-sector-tag neon" style={{ position: 'absolute', zIndex: 1, color: '#d9faff', fontSize: 10, fontWeight: 800, letterSpacing: '0.17em', textShadow: '0 2px 8px #162445', pointerEvents: 'none' }}>{district}</div>
    {failed && <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#eaffff', background: 'linear-gradient(155deg,#687dac,#663d8b 50%,#1c365d)' }}><p style={{ maxWidth: 310, textAlign: 'center' }}>Neon Rush · 3D er utilgjengelig i denne nettleseren. Økt og målinger fortsetter.</p></div>}
  </div>;
}
