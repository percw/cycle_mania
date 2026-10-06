import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { WorldSceneProps } from './worlds';

const LAP = 2400;
const route = (z: number) => 58 * Math.sin(z / LAP * Math.PI * 2) + 20 * Math.sin(z / LAP * Math.PI * 6);
const heading = (z: number) => Math.atan2(route(z + 0.2) - route(z), 0.2);

/** Original procedural light-cycle circuit. Visual upgrades are supplied by the training achievement engine. */
export default function TronWorld(props: WorldSceneProps & { achievements?: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props); live.current = props;
  const [failed, setFailed] = useState(false);
  const [sectorName, setSectorName] = useState('01 / THE GRID');

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false, frame = 0;
    let renderer: THREE.WebGPURenderer | undefined;
    let pipeline: THREE.RenderPipeline | undefined;
    let scenePass: ReturnType<typeof pass> | undefined;
    let glow: ReturnType<typeof bloom> | undefined;
    let observer: ResizeObserver | undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#02060b');
    scene.fog = new THREE.FogExp2('#07121e', 0.0029);
    const camera = new THREE.PerspectiveCamera(62, 1, 0.12, 2200);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    const geo = <T extends THREE.BufferGeometry>(shape: T) => { geometries.add(shape); return shape; };
    const skin = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const result = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.8, ...extra }); materials.add(result); return result;
    };
    const light = (color: string, strength = 1.5, opacity = 1) => {
      const result = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: THREE.DoubleSide });
      result.color.multiplyScalar(strength); materials.add(result); return result;
    };
    const cube = geo(new THREE.BoxGeometry(1, 1, 1));
    const mesh = (shape: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = scene) => {
      const result = new THREE.Mesh(shape, material); parent.add(result); return result;
    };
    const box = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const result = mesh(cube, material, parent); result.position.set(x, y, z); result.scale.set(sx, sy, sz); return result;
    };
    const cyan = light('#5ceaff', 2), orange = light('#ff9b31', 2), white = light('#dcfbff', 1.6);
    const dim = light('#2a6c82', 1.1), graphite = skin('#152330'), armor = skin('#263c4b', { roughness: 0.23 });
    const obsidian = skin('#060d16', { roughness: 0.18, metalness: 0.88 });
    const monolith = skin('#132331', { emissive: '#0b1b29', emissiveIntensity: 0.4, roughness: 0.38, metalness: 0.55 });
    const architectureLine = light('#3b9cb8', 1.25);
    scene.add(new THREE.HemisphereLight('#a9dcff', '#142d3c', 2.2));
    const key = new THREE.DirectionalLight('#caeaff', 3.2); key.position.set(-50, 90, 10); scene.add(key);
    const rim = new THREE.DirectionalLight('#ff9d56', 2.2); rim.position.set(100, 25, -70); scene.add(rim);
    const floor = mesh(geo(new THREE.PlaneGeometry(6000, 9000)), skin('#08111b', { roughness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.22;
    // A deliberately quiet grid: one instanced draw call, no texture downloads or random scenery.
    const grid = new THREE.InstancedMesh(cube, light('#1d566b', 1.0), 182); scene.add(grid);
    const dummy = new THREE.Object3D();
    const place = (batch: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) => {
      dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix(); batch.setMatrixAt(index, dummy.matrix);
    };
    for (let i = 0; i < 91; i++) {
      place(grid, i, (i - 45) * 20, -0.17, 0, 0.065, 0.02, 1800);
      place(grid, 91 + i, 0, -0.17, (i - 45) * 20, 1800, 0.02, 0.065);
    }
    function roadStrip(offset: number, width: number, height: number, material: THREE.Material) {
      const positions: number[] = [], indices: number[] = [];
      for (let i = 0; i <= 1800; i++) {
        const z = -4800 + i * 4, x = route(z) + offset;
        positions.push(x - width / 2, height, z, x + width / 2, height, z);
        if (i < 1800) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const shape = geo(new THREE.BufferGeometry()); shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); shape.setIndex(indices); shape.computeVertexNormals(); mesh(shape, material);
    }
    roadStrip(0, 19, 0, obsidian);
    for (const side of [-1, 1]) {
      roadStrip(side * 9.35, 0.13, 0.06, side < 0 ? cyan : orange);
      roadStrip(side * 9.62, 0.035, 0.045, dim);
      roadStrip(side * 3.1, 0.035, 0.025, dim);
      roadStrip(side * 9.35, 0.48, 0.022, light(side < 0 ? '#3bdcff' : '#ee791d', 0.6, 0.2));
    }
    const marks = new THREE.InstancedMesh(cube, dim, 900); scene.add(marks);
    for (let i = 0; i < 900; i++) { const z = -4800 + i * 8; place(marks, i, route(z), 0.026, z, 0.1, 0.02, 2.5, heading(z)); }
    const enduranceLights = new THREE.Group(); scene.add(enduranceLights);
    const recoveryArches = new THREE.Group(); scene.add(recoveryArches);
    const tunnelTrim = light('#64ebf9', 1.4);
    // Three districts, repeated outside the camera's range for a seamless lap.
    for (const shift of [-LAP, 0, LAP]) {
      for (let i = 0; i < 24; i++) {
        const z = shift - i * 100, x = route(z), side = i % 2 ? -1 : 1;
        const height = 38 + (i * 37 % 90), distance = 58 + (i * 29 % 105);
        const tower = new THREE.Group(); tower.position.set(x + side * distance, 0, z); tower.rotation.y = i * 0.27; scene.add(tower);
        box(tower, monolith, 0, height / 2, 0, 26, height, 28);
        box(tower, architectureLine, -13.04, height / 2, 14.04, 0.3, height, 0.3);
        box(tower, architectureLine, 13.04, height / 2, 14.04, 0.3, height, 0.3);
        box(tower, dim, 0, height * 0.68, 14.1, 26, 0.2, 0.15);
        box(tower, architectureLine, -13.05, height, 0, 0.3, 0.25, 28);
        box(tower, i % 3 ? cyan : orange, 0, height - 0.4, 14.08, 26, 0.32, 0.16);
        const beacon = box(enduranceLights, i % 3 ? cyan : orange, x + side * distance, height + 7, z, 0.24, 14, 0.24);
        beacon.rotation.y = i * 0.27;
      }
      // Quiet navigation frames make depth and the next bend legible in every district.
      // These belong to the circuit; earned recovery arches remain a separate, larger visual upgrade.
      for (let i = 0; i < 10; i++) {
        const z = shift - 160 - i * 240;
        if (i === 3 || i === 4) continue; // The data tunnel supplies its own architecture here.
        const frame = new THREE.Group(); frame.position.set(route(z), 0, z); frame.rotation.y = heading(z); scene.add(frame);
        for (const side of [-1, 1]) {
          box(frame, monolith, side * 12.3, 6.3, 0, 0.9, 12.6, 1.15);
          box(frame, side < 0 ? cyan : orange, side * 11.79, 6.3, 0.62, 0.13, 12.6, 0.16);
        }
        box(frame, monolith, 0, 12.6, 0, 25.5, 0.7, 1.15);
        box(frame, architectureLine, 0, 12.18, 0.62, 23.7, 0.12, 0.16);
        box(frame, white, 0, 12.18, 0.74, 2.6, 0.15, 0.1);
      }
      for (let i = 0; i < 11; i++) {
        const z = shift - 830 - i * 31, arch = new THREE.Group(); arch.position.set(route(z), 0, z); arch.rotation.y = heading(z); scene.add(arch);
        for (const side of [-1, 1]) {
          box(arch, graphite, side * 13.4, 9, 0, 1.7, 18, 2.8);
          box(arch, side < 0 ? cyan : orange, side * 12.48, 8.7, 0.2, 0.1, 17.4, 0.28);
        }
        box(arch, graphite, 0, 18, 0, 28.5, 1.8, 2.8);
        box(arch, tunnelTrim, 0, 17.03, 0.2, 25, 0.12, 0.3);
        box(arch, obsidian, -16, 10, -13, 1.1, 20, 30);
        box(arch, obsidian, 16, 10, -13, 1.1, 20, 30);
      }
      for (let i = 0; i < 6; i++) {
        const z = shift - 1450 - i * 72, arch = new THREE.Group(); arch.position.set(route(z), 0, z); arch.rotation.y = heading(z); recoveryArches.add(arch);
        const halo = mesh(geo(new THREE.TorusGeometry(17, 0.095, 5, 6, Math.PI)), cyan, arch); halo.position.y = 1;
        box(arch, dim, -17, 0.5, 0, 0.12, 1, 0.12); box(arch, dim, 17, 0.5, 0, 0.12, 1, 0.12);
      }
      const core = new THREE.Group(); core.position.set(route(shift - 2100) + 112, 75, shift - 2100); scene.add(core);
      const ringShape = geo(new THREE.TorusGeometry(53, 0.45, 8, 6));
      mesh(ringShape, orange, core); const inner = mesh(ringShape, dim, core); inner.scale.setScalar(0.8);
      const slab = box(core, obsidian, 0, 0, -8, 72, 100, 15); slab.rotation.z = Math.PI / 4;
      box(core, orange, 0, -70, 0, 0.2, 70, 0.2);
    }

    // Collapse static cuboid architecture into a handful of material batches for mobile GPUs.
    function batchBoxes(parent: THREE.Object3D) {
      parent.updateWorldMatrix(true, true);
      const batches = new Map<THREE.Material, THREE.Mesh[]>();
      parent.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.geometry !== cube || Array.isArray(object.material)) return;
        const list = batches.get(object.material) ?? []; list.push(object); batches.set(object.material, list);
      });
      const inverse = parent.matrixWorld.clone().invert();
      for (const [material, objects] of batches) {
        const batch = new THREE.InstancedMesh(cube, material, objects.length);
        objects.forEach((object, index) => { batch.setMatrixAt(index, inverse.clone().multiply(object.matrixWorld)); object.removeFromParent(); });
        parent.add(batch);
      }
    }
    batchBoxes(enduranceLights); batchBoxes(recoveryArches); batchBoxes(scene);

    // Destinations are built once. Target seconds change their physical state;
    // time alone can never open the vault or finish raising the bridge.
    const destinations = new THREE.Group(); scene.add(destinations);
    const journeyCyan = light('#52eeff', 1.7), journeyGold = light('#ffc071', 1.6);
    const destinationGroups = {
      bridge: new THREE.Group(), vault: new THREE.Group(),
      garden: new THREE.Group(), beacon: new THREE.Group(),
    };
    Object.values(destinationGroups).forEach(group => destinations.add(group));
    const bridge = destinationGroups.bridge;
    const bridgeSpans: THREE.Group[] = [];
    for (let i = 0; i < 5; i++) {
      const span = new THREE.Group(); span.position.z = 26 - i * 15; bridge.add(span); bridgeSpans.push(span);
      for (const side of [-1, 1]) {
        box(span, graphite, side * 22, 11, 0, 2.1, 22, 3);
        box(span, journeyCyan, side * 20.8, 11, 1.55, 0.16, 22, 0.18);
      }
      box(span, armor, 0, 22, 0, 46, 1.4, 3);
      box(span, journeyCyan, 0, 21.2, 1.55, 41.5, 0.16, 0.18);
      // Elevated side decks frame an open passage; the riding surface stays level.
      for (const side of [-1, 1]) {
        box(span, armor, side * 28, 4, 0, 10, 0.8, 14.5);
        box(span, journeyGold, side * 32.5, 5, 0, 0.13, 1.9, 14.5);
      }
      batchBoxes(span);
    }
    const vault = destinationGroups.vault;
    for (const side of [-1, 1]) {
      box(vault, armor, side * 28, 16, 0, 13, 32, 8);
      box(vault, journeyGold, side * 20.9, 16, 4.1, 0.28, 32, 0.25);
      box(vault, obsidian, side * 33, 12, -21, 10, 24, 40);
      box(vault, journeyCyan, side * 27.8, 12, -21, 0.2, 24, 40);
    }
    box(vault, armor, 0, 32, 0, 69, 5, 8);
    box(vault, journeyGold, 0, 28.9, 4.1, 41.8, 0.3, 0.25);
    batchBoxes(vault);
    const vaultDoors: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const door = new THREE.Group(); vault.add(door); vaultDoors.push(door);
      // Even uncharged, a generous central corridor remains clear.
      box(door, graphite, side * 15.8, 13, 0.7, 10, 26, 2);
      box(door, journeyCyan, side * 10.7, 13, 1.8, 0.22, 26, 0.2);
      for (let i = 0; i < 5; i++) box(door, dim, side * 15.8, 3 + i * 5, 1.8, 9.7, 0.12, 0.2);
      batchBoxes(door);
    }
    const garden = destinationGroups.garden;
    const gardenColumns: THREE.Group[] = [];
    const leafShape = geo(new THREE.OctahedronGeometry(3.1));
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? -1 : 1, rank = Math.floor(i / 2);
      const stem = new THREE.Group(); stem.position.set(side * (21 + rank % 3 * 7), 0, 28 - rank * 10); garden.add(stem); gardenColumns.push(stem);
      const height = 10 + (rank % 4) * 5;
      box(stem, graphite, 0, height / 2, 0, 1.2, height, 1.2);
      box(stem, journeyCyan, 0, height / 2, 0.65, 0.2, height, 0.13);
      const crystal = mesh(leafShape, i % 3 ? journeyCyan : journeyGold, stem); crystal.position.y = height + 2;
      const orbit = mesh(geo(new THREE.TorusGeometry(4.7, 0.065, 4, 24)), dim, stem); orbit.position.y = height; orbit.rotation.x = Math.PI / 2;
      batchBoxes(stem);
    }
    const beacon = destinationGroups.beacon;
    for (const side of [-1, 1]) {
      box(beacon, armor, side * 18, 8, 0, 2.8, 16, 4);
      box(beacon, journeyGold, side * 16.5, 8, 2.1, 0.2, 16, 0.2);
    }
    batchBoxes(beacon);
    // A low suspended core is visible within the riding camera's forward view.
    // Its lowest edge stays above the cycle even at full charge.
    const beaconCore = new THREE.Group(); beaconCore.position.y = 8.6; beacon.add(beaconCore);
    const beaconShape = geo(new THREE.TorusGeometry(5.2, 0.16, 6, 48));
    mesh(beaconShape, journeyCyan, beaconCore);
    const beaconInner = mesh(beaconShape, journeyGold, beaconCore); beaconInner.rotation.y = Math.PI / 3; beaconInner.scale.setScalar(0.75);
    const beaconHeart = mesh(geo(new THREE.IcosahedronGeometry(2.1, 0)), armor, beaconCore);
    const heartWire = mesh(geo(new THREE.IcosahedronGeometry(2.14, 0)), new THREE.MeshBasicMaterial({ color: '#8bf5ff', wireframe: true }), beaconCore); materials.add(heartWire.material);
    const energyBeam = box(beacon, journeyCyan, 0, 23, 0, 0.3, 18, 0.3);
    const revealMaterial = light('#c0fbff', 1.4, 0.0);
    const reveal = mesh(geo(new THREE.TorusGeometry(14, 0.16, 6, 48)), revealMaterial, destinations); reveal.position.set(0, 17, 5); reveal.visible = false;
    let journeyCharge = live.current.journey?.progress ?? 0;
    let journeySerial = live.current.journey?.eventSerial ?? 0, revealAge = 8, journeyTime = 0;
    let frozenJourney = live.current.journey;

    // A low, enclosed light-cycle silhouette with two large luminous wheels, armoured fairing and tucked rider.
    const bike = new THREE.Group(); scene.add(bike);
    const wheelShape = geo(new THREE.CylinderGeometry(0.91, 0.91, 0.62, 32));
    const ringShape = geo(new THREE.TorusGeometry(0.77, 0.08, 8, 36));
    const hubShape = geo(new THREE.CylinderGeometry(0.38, 0.38, 0.7, 20));
    const wheelUpgrade = new THREE.Group(); bike.add(wheelUpgrade);
    const wheels: THREE.Group[] = [];
    for (const z of [-1.57, 1.57]) {
      const wheel = new THREE.Group(); wheel.position.set(0, 0.94, z); bike.add(wheel); wheels.push(wheel);
      const tire = mesh(wheelShape, obsidian, wheel); tire.rotation.z = Math.PI / 2;
      const hub = mesh(hubShape, graphite, wheel); hub.rotation.z = Math.PI / 2;
      for (const side of [-1, 1]) {
        const ring = mesh(ringShape, cyan, wheel); ring.rotation.y = Math.PI / 2; ring.position.x = side * 0.325;
        const inner = mesh(ringShape, white, wheelUpgrade); inner.position.set(side * 0.334, 0.94, z); inner.rotation.y = Math.PI / 2; inner.scale.setScalar(0.72);
        box(wheel, cyan, side * 0.36, 0, 0, 0.06, 0.08, 0.52);
      }
    }
    const fairing = mesh(geo(new THREE.SphereGeometry(1, 24, 14)), armor, bike); fairing.scale.set(0.73, 0.57, 2.05); fairing.position.set(0, 1.2, -0.02);
    const front = mesh(geo(new THREE.SphereGeometry(1, 20, 12)), obsidian, bike); front.scale.set(0.65, 0.68, 0.95); front.position.set(0, 1.6, -0.75);
    box(bike, graphite, 0, 0.72, 0, 0.95, 0.42, 2.6);
    for (const side of [-1, 1]) {
      box(bike, cyan, side * 0.59, 1.11, 0, 0.075, 0.095, 2.5);
      box(bike, white, side * 0.28, 1.13, -2.08, 0.21, 0.09, 0.1);
    }
    const torso = mesh(geo(new THREE.CapsuleGeometry(0.32, 0.73, 5, 12)), graphite, bike); torso.position.set(0, 1.98, 0.22); torso.rotation.x = -0.87;
    const helmet = mesh(geo(new THREE.SphereGeometry(0.35, 20, 12)), armor, bike); helmet.position.set(0, 2.21, -0.43); helmet.scale.set(0.88, 0.85, 1.13);
    const visor = mesh(geo(new THREE.SphereGeometry(0.356, 16, 8, 0, Math.PI * 2, Math.PI * 0.33, Math.PI * 0.23)), cyan, helmet); visor.rotation.x = Math.PI / 2;
    const disc = mesh(geo(new THREE.TorusGeometry(0.2, 0.045, 6, 24)), cyan, bike); disc.position.set(0, 2.2, 0.42); disc.rotation.x = -0.7;
    function limb(a: number[], b: number[]) {
      const from = new THREE.Vector3(...a as [number, number, number]), to = new THREE.Vector3(...b as [number, number, number]);
      const part = mesh(geo(new THREE.CylinderGeometry(0.11, 0.15, from.distanceTo(to), 8)), graphite, bike);
      part.position.copy(from).add(to).multiplyScalar(0.5); part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
    }
    for (const side of [-1, 1]) {
      limb([side * 0.3, 2.03, -0.16], [side * 0.53, 1.57, -1.0]);
      limb([side * 0.24, 1.65, 0.72], [side * 0.58, 1.03, 0.12]);
      limb([side * 0.58, 1.03, 0.12], [side * 0.45, 0.79, 1.12]);
    }
    // The ribbon follows the exact route behind the cycle; it is never a straight box cutting through bends.
    const trailSegments = 88, trailShape = geo(new THREE.BufferGeometry());
    const trailPositions = new Float32Array((trailSegments + 1) * 6), trailColors = new Float32Array((trailSegments + 1) * 6), trailIndices: number[] = [];
    for (let i = 0; i <= trailSegments; i++) {
      const brightness = 0.95 * (1 - i / trailSegments) + 0.05;
      trailColors.set([0.03 * brightness, 0.55 * brightness, 0.8 * brightness, 0.03 * brightness, 0.45 * brightness, 0.62 * brightness], i * 6);
      if (i < trailSegments) { const k = i * 2; trailIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    trailShape.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3)); trailShape.setAttribute('color', new THREE.BufferAttribute(trailColors, 3)); trailShape.setIndex(trailIndices);
    const trailMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }); materials.add(trailMaterial);
    const trail = mesh(trailShape, trailMaterial); trail.frustumCulled = false;
    const trailEdgeShape = geo(new THREE.BufferGeometry()); const edgePositions = new Float32Array((trailSegments + 1) * 3);
    trailEdgeShape.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#a6f6ff', transparent: true, opacity: 0.8 }); materials.add(edgeMaterial);
    const trailEdge = new THREE.Line(trailEdgeShape, edgeMaterial); scene.add(trailEdge); trailEdge.frustumCulled = false;
    const consistencyRails = new THREE.Group(); bike.add(consistencyRails);
    for (const side of [-1, 1]) box(consistencyRails, white, side * 0.6, 1.23, 0.18, 0.05, 0.065, 2.45);
    // A soft contact pool grounds the cycle on the dark polished road.
    const pool = mesh(geo(new THREE.PlaneGeometry(2.3, 6.0)), light('#27b9dd', 0.8, 0.18), bike); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.027;
    const ghost = new THREE.Group(); scene.add(ghost);
    const ghostSkin = light('#ffa943', 1.2, 0.4);
    const ghostBody = mesh(geo(new THREE.SphereGeometry(1, 12, 8)), ghostSkin, ghost); ghostBody.scale.set(0.7, 0.65, 2.1); ghostBody.position.y = 1.2;
    for (const z of [-1.57, 1.57]) { const wheel = mesh(ringShape, ghostSkin, ghost); wheel.rotation.y = Math.PI / 2; wheel.position.set(0, 0.94, z); }
    let travel = Math.max(0, live.current.progress) * 8400, last = 0, lastSector = -1;
    let cameraYaw = heading(-travel), frozenGame = live.current.game;
    const ahead = new THREE.Vector3();
    const animate = (time: number) => {
      if (disposed || !renderer) return;
      const dt = last ? Math.min(0.06, (time - last) / 1000) : 0; last = time;
      const state = live.current;
      if (state.running) {
        travel += Math.max(0, state.speed) / 3.6 * dt;
        const expected = Math.max(0, state.progress) * 8400;
        if (Math.abs(expected - travel) > 35) {travel = expected; cameraYaw = heading(-travel % LAP);}
        else if (Math.abs(expected - travel) > 8) travel += (expected - travel) * Math.min(1, dt * 2);
        frozenGame = state.game;
        frozenJourney = state.journey;
      }
      const z = -travel % LAP, x = route(z), yaw = heading(z), game = frozenGame;
      const journey = frozenJourney;
      destinations.visible = !!journey;
      if (journey) {
        const movingDt = state.running ? dt : 0;
        journeyTime += movingDt;
        if (journey.eventSerial !== journeySerial) { journeySerial = journey.eventSerial; revealAge = 0; }
        revealAge += movingDt;
        const targetCharge = THREE.MathUtils.clamp(journey.progress, 0, 1);
        if (state.running && Math.abs(targetCharge - journeyCharge) > 0.2) journeyCharge = targetCharge;
        else journeyCharge += (targetCharge - journeyCharge) * Math.min(1, movingDt * 3);
        // Keep the destination close enough to read on a phone. Curving roads remain
        // unobstructed: all fixed supports stand outside the full riding corridor.
        // Target progress brings the structure from the approach, through the
        // rider, then behind them. It cannot remain stuck on the horizon.
        const destinationZ = z - 68 + journeyCharge * 84;
        destinations.position.set(route(destinationZ), 0, destinationZ);
        destinations.rotation.y = heading(destinationZ);
        for (const [variant, group] of Object.entries(destinationGroups)) group.visible = variant === journey.variant;
        const restore = journey.route === 'restore';
        journeyCyan.color.set(restore ? '#52eeff' : '#a89aff').multiplyScalar(1.3 + journeyCharge * 0.6);
        journeyGold.color.set(restore ? '#ffc071' : '#f995d9').multiplyScalar(1.4 + journeyCharge * 0.3);
        bridgeSpans.forEach((span, i) => { span.position.y = -3 + (3 + i * 0.6) * journeyCharge; });
        vaultDoors.forEach((door, i) => { door.position.x = (i ? 1 : -1) * journeyCharge * 10; door.position.y = journeyCharge * 5; });
        gardenColumns.forEach((column, i) => { column.scale.y = 0.28 + 0.72 * THREE.MathUtils.clamp(journeyCharge * 1.5 - (i % 4) * 0.13, 0, 1); });
        beaconCore.rotation.z = journeyTime * 0.13;
        beaconInner.rotation.x = journeyTime * 0.22;
        beaconHeart.rotation.y = heartWire.rotation.y = journeyTime * 0.18;
        beaconCore.scale.setScalar(0.6 + journeyCharge * 0.4);
        energyBeam.scale.x = energyBeam.scale.z = 0.08 + journeyCharge * 0.7;
        reveal.visible = revealAge < 3.5;
        if (reveal.visible) { reveal.scale.setScalar(0.8 + revealAge * 0.65); revealMaterial.opacity = Math.max(0, 1 - revealAge / 3.5) * 0.8; }
      }
      const earned = new Set(state.achievements ?? []);
      wheelUpgrade.visible = earned.has('precision'); enduranceLights.visible = earned.has('endurance'); recoveryArches.visible = earned.has('recovery'); consistencyRails.visible = earned.has('consistency');
      bike.position.set(x, 0.02, z); bike.rotation.y = yaw;
      bike.rotation.z = THREE.MathUtils.clamp((heading(z - 12) - heading(z + 12)) * 2, -0.2, 0.2);
      for (const wheel of wheels) wheel.rotation.x = -travel / 0.91;
      const locked = game.quality === 'locked';
      cyan.color.set(locked ? '#6defff' : '#48c8e7').multiplyScalar(locked ? 2.2 : 1.7);
      tunnelTrim.color.set(game.phase === 'recovery' || game.phase === 'cooldown' ? '#92e6ed' : '#65dfff').multiplyScalar(1.5);
      const trailLength = 42 + (earned.has('consistency') ? 26 : 0);
      for (let i = 0; i <= trailSegments; i++) {
        const tz = z + 2.42 + i / trailSegments * trailLength, tx = route(tz), height = 1.55;
        trailPositions.set([tx, 0.055, tz, tx, height, tz], i * 6); edgePositions.set([tx, height, tz], i * 3);
      }
      trailShape.getAttribute('position').needsUpdate = true; trailEdgeShape.getAttribute('position').needsUpdate = true;
      pool.material.opacity = locked ? 0.24 : 0.16;
      const delta = game.ghostDelta; ghost.visible = delta !== undefined && Number.isFinite(delta);
      if (ghost.visible && delta !== undefined) {
        const gz = z + (delta > 0 ? 1 : -1) * THREE.MathUtils.clamp(12 + Math.abs(delta) * 0.035, 12, 60);
        ghost.position.set(route(gz) - 3.5, 0.02, gz); ghost.rotation.y = heading(gz);
      }
      // Anchor translation to the cycle; smoothing heading only prevents simulation jumps leaving the rider behind.
      const angularDelta = Math.atan2(Math.sin(yaw - cameraYaw), Math.cos(yaw - cameraYaw));
      if (state.running) cameraYaw += angularDelta * Math.min(1, dt * 3);
      const portrait = camera.aspect < 0.85, follow = portrait ? 14.5 : 12.5, side = portrait ? 3.8 : 5.4;
      camera.position.set(x + Math.sin(cameraYaw) * follow + Math.cos(cameraYaw) * side, portrait ? 8 : 6.4, z + Math.cos(cameraYaw) * follow - Math.sin(cameraYaw) * side);
      ahead.set(route(z - 18), -6, z - 18); camera.lookAt(ahead);
      const desiredFov = portrait ? 68 : 62;
      if (camera.fov !== desiredFov) { camera.fov = desiredFov; camera.updateProjectionMatrix(); }
      grid.position.z = Math.round(z / 20) * 20; floor.position.z = z;
      const u = ((-z % LAP) + LAP) % LAP, sector = u < 800 ? 0 : u < 1250 ? 1 : 2;
      if (sector !== lastSector) { lastSector = sector; setSectorName(['01 / THE GRID', '02 / DATA TUNNEL', '03 / THE CORE'][sector]); live.current.onSector?.(sector); }
      try { pipeline ? pipeline.render() : renderer.render(scene, camera); }
      catch (error) { console.error('Tron circuit rendering failed', error); setFailed(true); return; }
      frame = requestAnimationFrame(animate);
    };
    async function initialize() {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
        await renderer.init(); if (disposed) { renderer.dispose(); return; }
        pipeline = new THREE.RenderPipeline(renderer); scenePass = pass(scene, camera); const color = scenePass.getTextureNode('output');
        glow = bloom(color, 0.3, 0.38, 1.0); glow.setResolutionScale(0.5); pipeline.outputNode = color.add(glow);
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        renderer.domElement.setAttribute('aria-label', 'Tron Grid: lyssykkel med glødende hjul og lysvegg på en svart, geometrisk bane'); container!.appendChild(renderer.domElement);
        live.current.onRenderer?.((renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2');
        const resize = () => { if (!renderer || disposed) return; const width = container!.clientWidth || 900, height = container!.clientHeight || 500; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(container!); resize(); frame = requestAnimationFrame(animate);
      } catch (error) { if (!disposed) { console.error('Unable to initialize Tron circuit', error); setFailed(true); live.current.onRenderer?.('2D'); } }
    }
    void initialize();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); renderer?.domElement.remove(); pipeline?.dispose(); glow?.dispose(); scenePass?.dispose();
      if (renderer?.hasInitialized()) renderer.dispose(); scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); scene.clear();
    };
  }, []);
  return <div ref={host} className="ride-scene tron-world" data-journey-variant={props.journey?.variant} data-journey-route={props.journey?.route} data-journey-progress={props.journey?.progress.toFixed(3)} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#02060b' }}>
    <div aria-hidden="true" className="world-sector-tag tron" style={{ position: 'absolute', zIndex: 1, pointerEvents: 'none', color: '#77e9f4', fontSize: 9, letterSpacing: '0.16em', opacity: 0.7 }}>{sectorName}</div>
    {failed && <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#bff8ff', background: 'linear-gradient(150deg,#06131e,#0b2330)' }}><p style={{ maxWidth: 310, textAlign: 'center' }}>Tron Grid · 3D er utilgjengelig i denne nettleseren. Økt og målinger fortsetter.</p></div>}
  </div>;
}
