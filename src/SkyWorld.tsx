import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import type { WorldSceneProps } from './worlds';
import { ArcadeMotion, speedFactor, surgeFactor } from './rideFeel';

const CIRCUIT = 1800;
const FORK_LENGTH = 300;
const FORK_START = 28;
const FORK_SPAN = 235;
const TAU = Math.PI * 2;
const STRUCTURE_THRESHOLDS = [1, 5, 15, 35, 70, 120];
const RELIC_THRESHOLDS = [1, 4, 10, 24, 48, 80];
// Both causeways meet every 300 m, so a new choice reaches the next junction promptly.
function forkPath(z: number, branch: number) {
  const base = path(z);
  const distance = ((142 - z) % FORK_LENGTH + FORK_LENGTH) % FORK_LENGTH;
  const fraction = Math.max(0, Math.min(1, (distance - FORK_START) / FORK_SPAN));
  const bend = Math.sin(fraction * Math.PI) ** 2;
  return { x: base.x + branch * 42 * bend, y: base.y + (branch > 0 ? 13 : -3) * bend };
}
function path(z: number) {
  const t = z / CIRCUIT * TAU;
  return { x: Math.sin(t * 2) * 43 + Math.sin(t * 5) * 12, y: 22 + Math.sin(t * 3) * 9 };
}
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/** A hand-built floating archipelago: the road, islands and landmarks share a seamless circuit. */
export default function SkyWorld(props: WorldSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGPURenderer | undefined;
    let observer: ResizeObserver | undefined;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const geo = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
    const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const value = new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...extra }); materials.add(value); return value;
    };
    const basic = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) => {
      const value = new THREE.MeshBasicMaterial({ color, ...extra }); materials.add(value); return value;
    };
    const scene = new THREE.Scene();
    const skyColor = new THREE.Color('#b4dce0');
    const recoverySky = new THREE.Color('#d5dce2');
    const activeSky = new THREE.Color('#abdce0');
    scene.background = skyColor;
    const fog = new THREE.Fog('#b4dce0', 155, 820);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1600);
    scene.add(new THREE.HemisphereLight('#edffff', '#7377a2', 2.5));
    const sunLight = new THREE.DirectionalLight('#fff1cf', 3.5);
    sunLight.position.set(-120, 240, -200); scene.add(sunLight);
    const fill = new THREE.DirectionalLight('#aab8ff', 1.2);
    fill.position.set(130, 30, 90); scene.add(fill);
    const ivory = mat('#eae5d5');
    const gold = mat('#c29e51', { metalness: 0.65, roughness: 0.36 });
    const pathLight = mat('#ffe9aa', { emissive: '#f8c55e', emissiveIntensity: 0.9, metalness: 0.3 });
    const grass = mat('#5fbaa1');
    const moss = mat('#3d897e');
    const rock = mat('#c8cadb', { flatShading: true, vertexColors: true });
    const bark = mat('#6c6971');
    const leaf = mat('#5cb6a4');
    const lilacLeaf = mat('#a69cca');
    const crystalMaterial = mat('#b4ffed', { emissive: '#5bdbdc', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.2 });
    const waterfallMat = mat('#b1f5ef', { emissive: '#72d5db', emissiveIntensity: 0.18, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    const foam = basic('#e9fff3', { transparent: true, opacity: 0.72 });
    const sphere = geo(new THREE.IcosahedronGeometry(1, 2));
    const cylinder = geo(new THREE.CylinderGeometry(1, 1, 1, 9));
    const box = geo(new THREE.BoxGeometry(1, 1, 1));
    const crystalGeo = geo(new THREE.CylinderGeometry(0, 1, 3.5, 5, 1));
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = scene) => {
      const object = new THREE.Mesh(geometry, material); parent.add(object); return object;
    };
    const place = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx) => {
      const object = mesh(geometry, material, parent); object.position.set(x, y, z); object.scale.set(sx, sy, sz); return object;
    };
    const expeditionEnabled = !!live.current.expedition;
    const branches = expeditionEnabled ? [-1, 1] : [0];
    const committedRoutes = new Map<number, number>();
    let circuitTurn = 0;
    function routePath(z: number) {
      if (!expeditionEnabled) return path(z);
      const segment = circuitTurn * (CIRCUIT / FORK_LENGTH) + Math.floor((142 - z) / FORK_LENGTH);
      return forkPath(z, committedRoutes.get(segment) ?? live.current.expedition?.branch ?? -1);
    }
    const up = new THREE.Vector3(0, 1, 0);
    function beam(parent: THREE.Object3D, material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
      const object = mesh(cylinder, material, parent);
      object.position.copy(a).add(b).multiplyScalar(0.5);
      const delta = b.clone().sub(a); object.scale.set(radius, delta.length(), radius);
      object.quaternion.setFromUnitVectors(up, delta.normalize()); return object;
    }
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const dummy = new THREE.Object3D();
    // A gently banking porcelain causeway, with gold filigree inset into both edges.
    function ribbon(offset: number, width: number, elevation: number, material: THREE.Material, branch: number) {
      const positions: number[] = [], indices: number[] = [];
      const segments = 1600;
      for (let i = 0; i <= segments; i++) {
        const z = 550 - i / segments * 4800;
        const p = branch ? forkPath(z, branch) : path(z);
        positions.push(p.x + offset - width / 2, p.y + elevation, z, p.x + offset + width / 2, p.y + elevation, z);
        if (i < segments) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
      }
      const geometry = geo(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      return mesh(geometry, material);
    }
    for (const branch of branches) {
      ribbon(0, 11, -0.3, gold, branch);
      ribbon(0, 10.5, branch === 1 ? 0.008 : 0, ivory, branch);
      ribbon(-4.55, 0.18, 0.025, pathLight, branch); ribbon(4.55, 0.18, 0.025, pathLight, branch);
      ribbon(-4.88, 0.045, 0.026, gold, branch); ribbon(4.88, 0.045, 0.026, gold, branch);
    }
    const seamMaterial = mat('#cfcbbd');
    const seams = new THREE.InstancedMesh(box, seamMaterial, 600 * branches.length);
    for (let b = 0; b < branches.length; b++) for (let i = 0; i < 600; i++) {
      const z = 545 - i * 8, p = branches[b] ? forkPath(z, branches[b]) : path(z);
      dummy.position.set(p.x, p.y + 0.015, z); dummy.scale.set(10.5, 0.015, 0.035); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); seams.setMatrixAt(b * 600 + i, dummy.matrix);
    }
    scene.add(seams);

    const loopObjects: { object: THREE.Object3D; z: number }[] = [];
    function loopGroup(z: number, x: number, y: number) {
      const group = new THREE.Group(); group.position.set(x, y, z); scene.add(group); loopObjects.push({ object: group, z }); return group;
    }
    function islandGeometry(radius: number, depth: number, seed: number) {
      const rand = seeded(seed), sides = 13;
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      const widths = [0.81, 1, 0.96, 0.77, 0.84, 0.48, 0.27, 0.02];
      const heights = [0, -2, -depth * 0.12, -depth * 0.22, -depth * 0.29, -depth * 0.58, -depth * 0.8, -depth];
      const offsets = Array.from({ length: sides }, () => 0.78 + rand() * 0.4);
      for (let ring = 0; ring < widths.length; ring++) {
        for (let side = 0; side < sides; side++) {
          const angle = side / sides * TAU;
          const radiusAt = radius * widths[ring] * offsets[side];
          positions.push(Math.cos(angle) * radiusAt + ring * 0.7, heights[ring] + (ring === 0 ? 0 : rand() * depth * 0.07), Math.sin(angle) * radiusAt * 0.8);
          const c = new THREE.Color(ring === 0 ? '#85b7a5' : ring < 3 ? '#acb2b1' : '#677f96');
          c.multiplyScalar(0.82 + rand() * 0.24); colors.push(c.r, c.g, c.b);
          if (ring < widths.length - 1) { const n = ring * sides + side, next = ring * sides + (side + 1) % sides; indices.push(n, next, n + sides, next, next + sides, n + sides); }
        }
      }
      // Cover the island top as well as its pointed underside.
      positions.push(0, 0, 0); colors.push(0.6, 0.8, 0.65);
      for (let i = 0; i < sides; i++) indices.push(positions.length / 3 - 1, (i + 1) % sides, i);
      const geometry = geo(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
    }
    function tree(parent: THREE.Object3D, x: number, z: number, size: number, seed: number, lilac = false) {
      const rand = seeded(seed);
      beam(parent, bark, v(x, 0, z), v(x + size * 0.06, size * 0.76, z), size * 0.045);
      const foliage = new THREE.InstancedMesh(sphere, lilac ? lilacLeaf : leaf, 9);
      for (let i = 0; i < 9; i++) {
        const angle = i / 9 * TAU;
        const bx = x + Math.cos(angle) * size * 0.24, bz = z + Math.sin(angle) * size * 0.22;
        const by = size * (0.66 + rand() * 0.23);
        if (i < 5) beam(parent, bark, v(x, size * 0.35, z), v(bx, by, bz), size * 0.018);
        dummy.position.set(bx, by, bz); dummy.scale.set(size * (0.22 + rand() * 0.12), size * 0.18, size * 0.28); dummy.rotation.set(rand(), rand(), rand()); dummy.updateMatrix(); foliage.setMatrixAt(i, dummy.matrix);
      }
      parent.add(foliage);
      // Buttress roots curl over the stone lip.
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU;
        beam(parent, bark, v(x, size * 0.18, z), v(x + Math.cos(a) * size * 0.19, 0.3, z + Math.sin(a) * size * 0.19), size * 0.026);
      }
    }
    const waterfalls: { object: THREE.Object3D; phase: number; height: number }[] = [];
    const restoredIslands: { group: THREE.Group; tower: THREE.Group; bridge: THREE.Mesh; height: number; rank: number }[] = [];
    const discoveredIslands: { group: THREE.Group; relic: THREE.Group; rank: number }[] = [];
    const islandsRandom = seeded(9715);
    for (let i = 0; i < 23; i++) {
      const z = 160 - i * (CIRCUIT / 23), p = path(z), side = i % 2 ? 1 : -1;
      const radius = 18 + islandsRandom() * 17;
      const group = loopGroup(z, p.x + side * (radius + (expeditionEnabled ? 75 : 15) + islandsRandom() * 38), p.y + 1 + islandsRandom() * 16);
      mesh(islandGeometry(radius, radius * (1.6 + islandsRandom() * 0.8), i * 73 + 14), rock, group);
      place(sphere, grass, group, 0, -0.15, 0, radius * 0.79, 1.7, radius * 0.6);
      place(sphere, moss, group, side * 7, -2, 0, radius * 0.65, 1.6, radius * 0.52);
      // Rock shelves, moss curtains and hanging vines break up the island silhouettes.
      for (let shelf = 0; shelf < 3; shelf++) {
        const angle = shelf * 2.2 + i;
        const sx = Math.cos(angle) * radius * 0.76, sz = Math.sin(angle) * radius * 0.65;
        place(sphere, moss, group, sx, -2.4 - shelf * 0.55, sz, radius * 0.27, 1.2, radius * 0.16);
        beam(group, moss, v(sx, -2, sz), v(sx + 1.2, -radius * (0.4 + shelf * 0.15), sz + 0.6), 0.16);
      }
      tree(group, -side * radius * 0.12, 0, radius * 1.3, i * 19 + 3, i >= 14);
      if (i % 3 !== 0) tree(group, radius * 0.4, radius * 0.22, radius * 0.7, i * 23 + 5, i >= 14);
      for (let c = 0; c < 4; c++) {
        const stone = place(crystalGeo, crystalMaterial, group, -side * radius * 0.52 + c * 1.8, 2.1 + (c % 2), -radius * 0.2, 1 + c * 0.25, 1.7 + c * 0.35, 1 + c * 0.25); stone.rotation.z = (c - 1.5) * 0.14;
      }
      if (i % 3 === 0 || (i >= 7 && i <= 13)) {
        const height = 80 + islandsRandom() * 60;
        const fall = place(box, waterfallMat, group, -side * radius * 0.74, -height / 2, 0, 4.5, height, 1.4);
        waterfalls.push({ object: fall, phase: i, height });
        for (let w = 0; w < 3; w++) {
          const stream = place(box, foam, group, -side * radius * 0.74 + (w - 1) * 1.1, -height / 2, -0.7, 0.12, height * 0.95, 0.13);
          waterfalls.push({ object: stream, phase: i + w, height: height * 0.95 });
        }
        place(sphere, foam, group, -side * radius * 0.74, -1, 0, 4, 0.5, 3);
      }
      if (expeditionEnabled && i % 2 === 0) {
        // Restoring an island raises a real tower and reconnects its suspended bridge.
        const tower = new THREE.Group(); group.add(tower);
        const height = 13 + (i % 3) * 5;
        for (const x of [-6, 6]) {
          place(cylinder, ivory, tower, x, height / 2, -5, 1.1, height, 1.1);
          place(box, gold, tower, x, height, -5, 3, 0.7, 3);
        }
        place(box, ivory, tower, 0, height + 0.7, -5, 16, 1.4, 4);
        place(crystalGeo, pathLight, tower, 0, height + 4, -5, 2.1, 2, 2.1);
        const road = forkPath(z, -1);
        const bridge = beam(group, ivory, v(-side * radius * 0.65, 0.2, 0), v(road.x - group.position.x + side * 6.3, road.y - group.position.y - 1.6, 0), 1.3);
        restoredIslands.push({ group, tower, bridge, height, rank: Math.floor(i / 2) % 6 });
      }
      if (expeditionEnabled && i % 2 === 1) {
        const relic = new THREE.Group(); relic.position.set(0, radius * 1.3 + 9, 0); group.add(relic);
        place(crystalGeo, crystalMaterial, relic, 0, 0, 0, 3, 4, 3);
        const orbit = mesh(geo(new THREE.TorusGeometry(7, 0.16, 6, 40)), gold, relic); orbit.rotation.x = 0.8;
        discoveredIslands.push({ group, relic, rank: Math.floor(i / 2) % 6 });
      }
      // Ruined columns and stone tablets make the islands read as a lost civilization.
      if (i % 4 === 0) {
        for (const x of [-7, 7]) {
          place(cylinder, ivory, group, x, 7, -8, 1.2, 14, 1.2);
          place(box, gold, group, x, 14, -8, 3.1, 0.55, 3.1);
        }
        place(box, ivory, group, 0, 14.8, -8, 19, 1.3, 3);
      }
    }
    // Close-in floating stepping stones support the road, and glow as precision builds.
    for (const branch of branches) for (let i = 0; i < 30; i++) {
      const z = 130 - i * 60, p = branch ? forkPath(z, branch) : path(z), group = loopGroup(z, p.x, p.y - 0.5);
      mesh(islandGeometry(8.2, 16, 930 + i), rock, group);
      for (const x of [-5.8, 5.8]) {
        place(box, ivory, group, x, 1.05, 0, 0.7, 2.5, 0.7);
        place(sphere, pathLight, group, x, 2.5, 0, 0.42, 0.42, 0.42);
      }
    }
    // Monumental ring temples frame the horizon; intimate gates establish forward rhythm.
    const gateGeometry = geo(new THREE.TorusGeometry(8.3, 0.22, 8, 64));
    const gateInlay = geo(new THREE.TorusGeometry(7.95, 0.06, 6, 64));
    for (const branch of branches) for (let i = 0; i < 18; i++) {
      const z = 76 - i * 100, p = branch ? forkPath(z, branch) : path(z), gate = loopGroup(z, p.x, p.y + 5.4);
      mesh(gateGeometry, gold, gate); mesh(gateInlay, pathLight, gate);
      for (const x of [-7.9, 7.9]) place(box, ivory, gate, x, -3.8, 0, 1.1, 7, 1.1);
      for (let j = 0; j < 8; j++) {
        const angle = j / 8 * TAU;
        const marker = place(box, pathLight, gate, Math.sin(angle) * 8.3, Math.cos(angle) * 8.3, 0, 0.15, 0.65, 0.3); marker.rotation.z = -angle;
      }
    }
    const grandRingGeo = geo(new THREE.TorusGeometry(45, 2.3, 8, 80));
    const grandInlayGeo = geo(new THREE.TorusGeometry(43.8, 0.32, 6, 80));
    const orbitGeo = geo(new THREE.TorusGeometry(29, 0.45, 6, 80));
    const observatoryRings: THREE.Mesh[] = [];
    const temples: { group: THREE.Group; doors: THREE.Group[]; crown: THREE.Group; facades: THREE.Group[]; bridge: THREE.Mesh[]; branch: number; opening: number; light: THREE.MeshStandardMaterial; rank: number; lastZ: number }[] = [];
    for (const branch of branches) for (let i = 0; i < 3; i++) {
      const z = 142 - (FORK_START + FORK_SPAN / 2) - i * 600, p = branch ? forkPath(z, branch) : path(z), temple = loopGroup(z, p.x, p.y + 33);
      mesh(grandRingGeo, ivory, temple);
      const templeLight = mat('#8dadab', { emissive: '#85ffe1', emissiveIntensity: 0.1 });
      mesh(grandInlayGeo, templeLight, temple);
      const crown = new THREE.Group(); temple.add(crown);
      const doors: THREE.Group[] = [];
      if (expeditionEnabled) {
        for (const side of [-1, 1]) {
          const door = new THREE.Group(); door.position.set(side * 5, -27, 0); temple.add(door);
          place(box, ivory, door, 0, 0, 0, 4.5, 13, 1.4);
          place(box, templeLight, door, -side * 1.8, 0, -0.8, 0.2, 11, 0.1);
          place(crystalGeo, gold, door, 0, 0, -1, 0.8, 1.4, 0.5);
          doors.push(door);
        }
        for (let tier = 0; tier < 5; tier++) {
          const ring = mesh(geo(new THREE.TorusGeometry(12 + tier * 3, 0.5, 6, 48)), tier % 2 ? gold : ivory, crown);
          ring.position.set(branch * 58, 17 + tier * 6, -15); ring.rotation.x = Math.PI / 2;
        }
        place(crystalGeo, crystalMaterial, crown, branch * 58, 33, -15, 6, 8, 6);
        const facades: THREE.Group[] = [];
        // Every later passage can reveal a different destination: hanging gardens,
        // a stepped archive, or an armillary observatory. Geometry changes off camera.
        for (let variant = 0; variant < 3; variant++) {
          const facade = new THREE.Group(); facade.position.set(branch * 59, -24, -19); temple.add(facade); facades.push(facade);
          mesh(islandGeometry(25, 55, i * 51 + variant + 600), rock, facade);
          if (variant === 0) {
            for (let tier = 0; tier < 4; tier++) {
              place(box, ivory, facade, 0, tier * 7, 0, 35 - tier * 7, 2.5, 28 - tier * 5);
              place(sphere, moss, facade, 0, tier * 7 + 1.4, 0, 17 - tier * 3.5, 0.8, 12 - tier * 2);
              for (const side of [-1, 1]) place(cylinder, gold, facade, side * (13 - tier * 2), tier * 7 + 4, 0, 0.55, 6, 0.55);
            }
            tree(facade, 0, 0, 17, i + 803, true);
          } else if (variant === 1) {
            for (let tier = 0; tier < 6; tier++) place(box, ivory, facade, 0, tier * 3, 0, 37 - tier * 5, 3, 30 - tier * 4);
            place(crystalGeo, templeLight, facade, 0, 25, 0, 4, 5, 4);
            for (const side of [-1, 1]) place(box, gold, facade, side * 13, 12, -8, 2, 24, 2);
          } else {
            for (let ring = 0; ring < 3; ring++) {
              const orbit = mesh(geo(new THREE.TorusGeometry(18 - ring * 2, 0.6, 6, 48)), ring === 1 ? templeLight : gold, facade);
              orbit.position.y = 20; orbit.rotation.set(ring * 0.9, ring * 0.75, 0.2);
            }
            place(sphere, crystalMaterial, facade, 0, 20, 0, 7);
            for (const side of [-1, 1]) place(cylinder, ivory, facade, side * 15, 10, 0, 1.2, 20, 1.2);
          }
        }
        const bridge: THREE.Mesh[] = [];
        for (let piece = 0; piece < 8; piece++) {
          bridge.push(place(box, piece % 2 ? gold : ivory, temple, branch * (9 + piece * 5.8), -33, -19, 5.5, 0.9, 5));
        }
        temples.push({ group: temple, doors, crown, facades, bridge, branch, opening: 0, light: templeLight, rank: i + (branch === 1 ? 3 : 0), lastZ: Infinity });
      }
      for (const x of [-39, 39]) {
        place(box, ivory, temple, x, -25, 0, 5, 55, 5);
        place(box, gold, temple, x, 4, 0, 8, 1.1, 8);
        for (let tier = 0; tier < 3; tier++) place(box, ivory, temple, x, -49 - tier * 2, 0, 11 + tier * 5, 2.5, 11 + tier * 5);
      }
      for (let j = 0; j < 12; j++) {
        const a = j / 12 * TAU;
        const plate = place(box, gold, temple, Math.sin(a) * 45, Math.cos(a) * 45, 0, 3.1, 4.6, 5.4); plate.rotation.z = -a;
      }
      if (i === 2 || branch === 1) {
        const observatory = new THREE.Group(); observatory.position.set(82, 35, -40); temple.add(observatory);
        place(sphere, crystalMaterial, observatory, 0, 0, 0, 11);
        for (let ring = 0; ring < 3; ring++) {
          const orbit = mesh(orbitGeo, gold, observatory); orbit.rotation.set(ring * 0.85, ring * 0.7, 0.3); observatoryRings.push(orbit);
        }
      }
    }
    // Tiny distant islands recede through the atmospheric haze.
    const distantRandom = seeded(752);
    for (let i = 0; i < 16; i++) {
      const z = 240 - i * 115, side = i % 2 ? -1 : 1;
      const group = loopGroup(z, side * (190 + distantRandom() * 160), 30 + distantRandom() * 110);
      const radius = 25 + distantRandom() * 35;
      mesh(islandGeometry(radius, radius * 1.8, 490 + i), rock, group);
      place(sphere, grass, group, 0, 0, 0, radius * 0.74, 2, radius * 0.6);
      if (i % 2) tree(group, 0, 0, radius, i + 330, true);
    }
    const cloudMat = mat('#edf5ee', { roughness: 1 });
    const cloudGroup = loopGroup(-650, 0, -72);
    const clouds = new THREE.InstancedMesh(sphere, cloudMat, 560);
    const cloudRandom = seeded(4021);
    for (let i = 0; i < 560; i++) {
      const size = 17 + cloudRandom() * 39;
      dummy.position.set((cloudRandom() - 0.5) * 1150, -cloudRandom() * 40, (cloudRandom() - 0.5) * 2300);
      dummy.scale.set(size * 1.7, size * 0.37, size); dummy.rotation.set(0, cloudRandom() * TAU, 0); dummy.updateMatrix(); clouds.setMatrixAt(i, dummy.matrix);
    }
    cloudGroup.add(clouds);
    const sun = place(geo(new THREE.SphereGeometry(27, 24, 16)), basic('#fff1d1', { fog: false }), scene, -285, 230, -850);
    const halo = place(geo(new THREE.SphereGeometry(37, 24, 16)), basic('#fff0d0', { transparent: true, opacity: 0.12, depthWrite: false, fog: false }), scene, -285, 230, -850);

    // Earned relics form a spatial constellation above the next horizon.
    const constellation = new THREE.Group(); constellation.visible = expeditionEnabled; scene.add(constellation);
    const relicStars: THREE.Mesh[] = [], relicLinks: THREE.Mesh[] = [];
    const constellationPoints = Array.from({ length: 6 }, (_, i) => v((i - 2.5) * 10, 28 + Math.sin(i * 1.7) * 5, -135 - i * 3));
    for (let i = 0; i < constellationPoints.length; i++) {
      const point = constellationPoints[i];
      relicStars.push(place(crystalGeo, crystalMaterial, constellation, point.x, point.y, point.z, 1.3, 1.6, 1.3));
      if (i) relicLinks.push(beam(constellation, pathLight, constellationPoints[i - 1], point, 0.08));
    }
    const revealRing = mesh(geo(new THREE.TorusGeometry(12, 0.12, 6, 64)), basic('#dcfff3', { transparent: true, opacity: 0, depthWrite: false }), scene);
    revealRing.visible = false;

    // An ivory sailship glides alongside the archipelago, leaving space for the rider.
    const ship = loopGroup(-130, 90, 59);
    place(sphere, ivory, ship, 0, 0, 0, 6, 3, 18);
    place(sphere, gold, ship, 0, -1, 0, 5.6, 1.8, 17);
    beam(ship, gold, v(0, 0, 1), v(0, 21, 1), 0.25);
    const sail = mesh(geo(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI)), mat('#fff5e0', { side: THREE.DoubleSide }), ship);
    sail.scale.set(13, 12, 3); sail.position.set(0, 12, 1); sail.rotation.y = 0.18;
    place(box, ivory, ship, 0, 2.5, 7, 7, 2, 6);
    for (const x of [-5, 5]) place(sphere, crystalMaterial, ship, x, -3, -3, 0.7, 2, 0.7);

    // A readable wind-bike avatar: luminous wheels, golden spars, sail wings and a rider.
    const rider = new THREE.Group(); scene.add(rider);
    const riderDark = mat('#414d69');
    const riderSuit = mat('#eaf6e5');
    const bikeGlow = mat('#9ffff1', { emissive: '#58ffdd', emissiveIntensity: 1.4 });
    const wheelGeo = geo(new THREE.TorusGeometry(0.66, 0.075, 8, 32));
    const wheels: THREE.Mesh[] = [];
    for (const z of [-1.05, 1.05]) {
      const wheel = place(wheelGeo, bikeGlow, rider, 0, 0.9, z); wheel.rotation.y = Math.PI / 2; wheels.push(wheel);
      const hub = place(sphere, gold, rider, 0, 0.9, z, 0.16);
      hub.scale.x = 1.5;
      beam(rider, gold, v(0, 0.9, z), v(0, 1.4, 0), 0.07);
    }
    beam(rider, ivory, v(0, 1.4, 0.45), v(0, 1.6, -0.9), 0.1);
    beam(rider, gold, v(-0.47, 1.8, -0.9), v(0.47, 1.8, -0.9), 0.065);
    place(sphere, riderDark, rider, 0, 1.5, 0.46, 0.29, 0.12, 0.38);
    const wingGeometry = geo(new THREE.BufferGeometry());
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 3.5,-0.28,1.9, 1.65,0.12,-0.7, 0,0,0, -1.65,0.12,-0.7, -3.5,-0.28,1.9], 3)); wingGeometry.computeVertexNormals();
    const wings = mesh(wingGeometry, mat('#efe9c9', { metalness: 0.25, roughness: 0.35, side: THREE.DoubleSide }), rider); wings.position.set(0, 0.97, 0.1);
    for (const side of [-1, 1]) {
      beam(rider, gold, v(0, 1.0, 0.1), v(side * 3.5, 0.7, 2), 0.045);
      place(sphere, bikeGlow, rider, side * 3.5, 0.7, 2, 0.14);
      beam(rider, riderDark, v(side * 0.17, 1.9, 0.5), v(side * 0.24, 1.23, -0.03), 0.12);
      beam(rider, riderSuit, v(side * 0.24, 1.23, -0.03), v(side * 0.23, 0.68, 0.3), 0.08);
      beam(rider, riderSuit, v(side * 0.23, 2.4, -0.03), v(side * 0.42, 1.82, -0.9), 0.095);
    }
    beam(rider, riderSuit, v(0, 1.96, 0.45), v(0, 2.45, -0.02), 0.27);
    place(sphere, riderDark, rider, 0, 2.68, -0.15, 0.24, 0.26, 0.25);
    place(sphere, ivory, rider, 0, 2.83, -0.15, 0.29, 0.16, 0.31);
    const scarf = place(box, pathLight, rider, 0, 2.36, 0.7, 0.48, 0.08, 1.4); scarf.rotation.x = -0.16;
    // Only a recorded personal best supplies this ghost; it is never an invented rival.
    const ghost = new THREE.Group();
    ghost.visible = false;
    scene.add(ghost);
    const ghostMaterial = basic('#ffe5a0', { transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
    const ghostCore = basic('#fff0be', { transparent: true, opacity: 0.58, depthWrite: false });
    const ghostWings = mesh(wingGeometry, ghostMaterial, ghost);
    ghostWings.scale.set(0.83, 1, 0.85);
    place(sphere, ghostCore, ghost, 0, 0.1, 0, 0.22, 0.2, 1.1);
    place(sphere, ghostCore, ghost, 0, 0.28, -0.8, 0.2, 0.23, 0.28);
    for (const side of [-1, 1]) beam(ghost, ghostCore, v(0, 0, 0), v(side * 2.9, -0.22, 1.6), 0.025);
    const trail = new THREE.InstancedMesh(sphere, bikeGlow, 32); scene.add(trail);
    const firefly = new THREE.InstancedMesh(sphere, basic('#fff2ae'), 80); scene.add(firefly);
    const glowRandom = seeded(982);
    const motes = Array.from({ length: 80 }, () => ({ x: (glowRandom() - 0.5) * 90, y: glowRandom() * 28, z: -glowRandom() * 145, phase: glowRandom() * TAU }));
    let elapsed = 0, travel = Math.max(0, Number.isFinite(live.current.progress) ? live.current.progress : 0) * 8400, last = 0, previousEvent = live.current.game.eventSerial, burst = 0;
    const motion = new ArcadeMotion(travel);
    let kick = 0;
    let lastSector = -1, ghostOffset = 0;
    let previousExpeditionEvent = live.current.expedition?.eventSerial ?? 0;
    let reveal = 0;
    const chaseDirection = new THREE.Vector3(0, 0, 1);
    const chaseTarget = new THREE.Vector3();
    let previousTravel = travel;
    let cameraReady = false;
    const openedTemples = new Set<THREE.Group>();
    const look = new THREE.Vector3();
    function animate(time: number) {
      if (disposed || !renderer) return;
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0; last = time;
      const state = live.current;
      // Arcade speed; recorded jumps (restore, skip, virtual time) still resync the chase rig at once.
      const jumpedNow = motion.update(dt, state.running, state.speed, Math.max(0, state.progress) * 8400);
      travel = motion.travel;
      const fast = speedFactor(motion.speed);
      kick += (surgeFactor(motion.accel) - kick) * Math.min(1, dt * 4);
      if (state.running) { elapsed += dt; burst = Math.max(0, burst - dt * 0.6); }
      const travelJump = jumpedNow || Math.abs(travel - previousTravel - motion.speed / 3.6 * dt) > 6;
      const wrapped = Math.floor(travel / CIRCUIT) !== Math.floor(previousTravel / CIRCUIT);
      previousTravel = travel;
      if (state.game.eventSerial !== previousEvent) { previousEvent = state.game.eventSerial; burst = 1; }
      const expedition = state.expedition;
      circuitTurn = Math.floor(travel / CIRCUIT);
      const routeSegment = Math.floor((travel + 11) / FORK_LENGTH);
      if (expedition && (travel + 11) % FORK_LENGTH >= FORK_START - 3 && !committedRoutes.has(routeSegment)) {
        committedRoutes.set(routeSegment, expedition.branch);
        // Only a handful of recent decisions are needed for the camera and trailing bike.
        for (const segment of committedRoutes.keys()) if (segment < routeSegment - 4) committedRoutes.delete(segment);
      }
      if (state.running) reveal = Math.max(0, reveal - dt * 0.3);
      if (expedition && expedition.eventSerial !== previousExpeditionEvent) {
        previousExpeditionEvent = expedition.eventSerial;
        reveal = 1;
        const nearest = temples.filter(item => item.branch === expedition.branch)
          .sort((a, b) => Math.abs(a.group.position.z - (142 - travel % CIRCUIT - 90)) - Math.abs(b.group.position.z - (142 - travel % CIRCUIT - 90)))[0];
        if (nearest) openedTemples.add(nearest.group);
      }
      const sector = Math.floor((travel % CIRCUIT) / 600);
      if (sector !== lastSector) { lastSector = sector; state.onSector?.(sector); }
      const z = 142 - travel % CIRCUIT, p = routePath(z), bikeZ = z - 11, bikePath = routePath(bikeZ);
      const ghostDelta = state.game.ghostDelta;
      const showGhost = typeof ghostDelta === 'number' && Number.isFinite(ghostDelta);
      if (showGhost) {
        // Positive score difference means the rider is ahead: the ghost falls behind (+z).
        const targetOffset = THREE.MathUtils.clamp(ghostDelta * 0.045, -38, 19);
        if (!ghost.visible) ghostOffset = targetOffset;
        else if (state.running) ghostOffset += (targetOffset - ghostOffset) * Math.min(1, dt * 3);
        const ghostZ = bikeZ + ghostOffset, ghostPath = routePath(ghostZ);
        ghost.position.set(ghostPath.x + 2.7, ghostPath.y + 2.9 + Math.sin(elapsed * 1.5) * 0.13, ghostZ);
        ghost.rotation.set(0, Math.atan2(routePath(ghostZ + 0.1).x - ghostPath.x, 0.1), Math.sin(elapsed) * 0.035);
        ghostWings.rotation.x = Math.sin(elapsed * 2) * 0.045;
      }
      ghost.visible = showGhost;
      for (const item of loopObjects) item.object.position.z = item.z + Math.round((z - 480 - item.z) / CIRCUIT) * CIRCUIT;
      const direction = Math.atan2(routePath(bikeZ + 0.1).x - bikePath.x, 0.1);
      rider.position.set(bikePath.x, bikePath.y + 0.32 + Math.sin(elapsed * 2.3) * 0.1, bikeZ);
      rider.rotation.set(0, direction, Math.sin(elapsed * 0.8) * (state.running ? 0.018 : 0));
      const recovering = state.game.phase === 'recovery' || state.game.phase === 'cooldown';
      if (state.running) { skyColor.lerp(recovering ? recoverySky : activeSky, Math.min(1, dt * 0.16)); fog.color.copy(skyColor); }
      wings.rotation.z = Math.sin(elapsed * (recovering ? 1.2 : 2)) * 0.025;
      wings.rotation.x = recovering ? -0.09 : 0;
      scarf.rotation.x = -0.16 + Math.sin(elapsed * 6) * 0.1;
      for (const wheel of wheels) wheel.rotation.x = elapsed * 4;
      const charge = THREE.MathUtils.clamp(expedition?.charge ?? state.game.charge, 0, 1);
      crystalMaterial.emissiveIntensity = 0.45 + charge * 2 + burst * 1.3;
      pathLight.emissiveIntensity = 0.55 + charge * 1.4 + burst;
      bikeGlow.emissiveIntensity = 0.7 + charge * 1.7;
      bikeGlow.color.set(state.zoneColor || '#9ffff1');
      if (expedition) {
        const restored = STRUCTURE_THRESHOLDS.filter(threshold => expedition.worldRestored >= threshold).length;
        const discovered = RELIC_THRESHOLDS.filter(threshold => expedition.worldDiscovered >= threshold).length;
        for (const island of restoredIslands) {
          const awake = island.rank < restored;
          const target = awake ? 1 : 0.12;
          if (state.running || !cameraReady) island.tower.scale.y += (target - island.tower.scale.y) * (cameraReady ? Math.min(1, dt * 1.8) : 1);
          island.bridge.visible = awake;
        }
        for (const island of discoveredIslands) {
          island.relic.visible = island.rank < discovered;
          island.relic.rotation.y = elapsed * 0.2 + island.rank;
          island.relic.position.y = 40 + Math.sin(elapsed * 0.6 + island.rank) * 2;
        }
        constellation.position.set(p.x, p.y, z);
        relicStars.forEach((star, index) => { star.visible = index < discovered; star.rotation.y = elapsed * 0.3 + index; });
        relicLinks.forEach((link, index) => { link.visible = index + 1 < discovered; });
        revealRing.visible = reveal > 0;
        const revealPath = routePath(z - 65);
        revealRing.position.set(revealPath.x, revealPath.y + 12 + (1 - reveal) * 18, z - 65);
        revealRing.scale.setScalar(1 + (1 - reveal) * 3);
        (revealRing.material as THREE.MeshBasicMaterial).opacity = reveal * 0.75;
        for (const temple of temples) {
          if (temple.lastZ !== temple.group.position.z) {
            temple.lastZ = temple.group.position.z;
            const chapter = Math.floor((restored + discovered) / 2);
            const variant = (temple.rank + expedition.stage + chapter + circuitTurn) % 3;
            temple.facades.forEach((facade, index) => { facade.visible = index === variant; });
          }
          const distance = bikeZ - temple.group.position.z;
          const nearby = distance > -20 && distance < 230;
          const permanent = temple.branch < 0 ? temple.rank < restored : temple.rank - 3 < discovered;
          const selected = temple.branch === (committedRoutes.get(routeSegment) ?? expedition.branch);
          // The gate responds ahead of the rider. Its central gap always remains rideable.
          const target = permanent || openedTemples.has(temple.group) ? 1 : nearby && selected ? 0.12 + charge * 0.88 : 0;
          if (state.running || !cameraReady) temple.opening += (target - temple.opening) * (cameraReady ? Math.min(1, dt * 2) : 1);
          temple.doors.forEach((door, index) => {
            const side = index ? 1 : -1;
            door.position.x = side * (6.5 + temple.opening * 9);
            door.position.y = -27 + temple.opening * 5;
            door.rotation.y = side * temple.opening * 0.5;
          });
          temple.bridge.forEach((piece, index) => {
            const assembly = THREE.MathUtils.clamp(temple.opening * 1.6 - index * 0.075, 0, 1);
            piece.position.y = -33 - (1 - assembly) * (12 + index * 2);
            piece.rotation.z = temple.branch * (1 - assembly) * 0.15;
          });
          temple.light.emissiveIntensity = 0.12 + temple.opening * 2.4 + (nearby && selected ? reveal * 3 : 0);
          temple.crown.visible = permanent || temple.opening > 0.3;
          temple.crown.scale.y = Math.max(0.05, temple.opening);
          temple.crown.rotation.y = Math.sin(elapsed * 0.12 + temple.rank) * 0.08;
        }
      }
      for (const ring of observatoryRings) ring.rotation.y = elapsed * 0.05 + observatoryRings.indexOf(ring) * 0.9;
      for (const waterfall of waterfalls) waterfall.object.scale.y = waterfall.height * (1 + Math.sin(elapsed * 1.4 + waterfall.phase) * 0.012);
      for (let i = 0; i < 32; i++) {
        const trailZ = bikeZ + 1.6 + i * 0.35, tp = routePath(trailZ), side = i % 2 ? -1 : 1;
        dummy.position.set(tp.x + side * 3.3, tp.y + 0.8 + Math.sin(elapsed * 4 + i) * 0.045, trailZ);
        const size = (1 - i / 32) * (0.06 + charge * 0.1);
        dummy.scale.set(size, size, 0.35); dummy.rotation.set(0, direction, 0); dummy.updateMatrix(); trail.setMatrixAt(i, dummy.matrix);
      }
      trail.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < motes.length; i++) {
        const mote = motes[i];
        const mz = z + mote.z + (elapsed * 1.5 % 25), mp = routePath(mz);
        dummy.position.set(mp.x + mote.x + Math.sin(elapsed * 0.3 + mote.phase) * 2, mp.y + mote.y + Math.sin(elapsed + mote.phase) * 0.6, mz);
        const size = (0.045 + charge * 0.08 + burst * 0.1) * (1 + Math.sin(elapsed * 2 + mote.phase) * 0.3);
        dummy.scale.setScalar(size); dummy.updateMatrix(); firefly.setMatrixAt(i, dummy.matrix);
      }
      firefly.instanceMatrix.needsUpdate = true;
      // Smooth the heading, never the rider's world position: even a large time
      // step keeps the wind-bike at a fixed, readable distance from the camera.
      const behind = routePath(bikeZ + 6), forward = routePath(bikeZ - 6);
      chaseTarget.set(behind.x - forward.x, 0, 12).normalize();
      if (!cameraReady || travelJump || wrapped) chaseDirection.copy(chaseTarget);
      else if (state.running) chaseDirection.lerp(chaseTarget, 1 - Math.exp(-dt * 7)).normalize();
      const portrait = camera.aspect < 0.8;
      const chaseDistance = (portrait ? 16 : 12.5) + fast * 3 + kick * 1.2;
      const desiredFov = 58 + fast * 18 + kick * 8;
      if (Math.abs(camera.fov - desiredFov) > 0.02) { camera.fov += (desiredFov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); }
      camera.position.set(
        rider.position.x + chaseDirection.x * chaseDistance,
        rider.position.y + (portrait ? 7 : 6.5),
        rider.position.z + chaseDirection.z * chaseDistance,
      );
      look.set(rider.position.x - chaseDirection.x * 12, rider.position.y - 1, rider.position.z - chaseDirection.z * 12);
      camera.lookAt(look);
      cameraReady = true;
      sun.position.z = z - 850; halo.position.copy(sun.position);
      try { renderer.render(scene, camera); } catch (error) { if (!disposed) { console.error('Skybound render failed', error); setFailed(true); } return; }
      frame = requestAnimationFrame(animate);
    }
    async function initialize() {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
        await renderer.init();
        if (disposed) { renderer.dispose(); return; }
        const canvas = renderer.domElement;
        canvas.style.cssText = 'width:100%;height:100%;display:block;position:absolute;inset:0';
        canvas.setAttribute('aria-label', 'Skybound: svevende øyer, lysende porter og en gyllen himmelvei');
        container!.appendChild(canvas);
        const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
        live.current.onRenderer?.(backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2');
        const resize = () => { if (!renderer || disposed) return; const width = container!.clientWidth || 900, height = container!.clientHeight || 500; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(container!); resize();
        frame = requestAnimationFrame(animate);
      } catch (error) { if (!disposed) { console.error('Skybound could not initialize', error); setFailed(true); live.current.onRenderer?.('2D'); } }
    }
    void initialize();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); renderer?.domElement.remove();
      if (renderer?.hasInitialized()) renderer.dispose();
      scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); scene.clear();
    };
  }, []);
  return <div ref={host} className="ride-scene" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#b4dce0' }}>
    {failed && <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#254b56', background: 'linear-gradient(#aed9df,#e8dcce)' }}><p>Skybound · 3D er utilgjengelig. Økten fortsetter som vanlig.</p></div>}
  </div>;
}
