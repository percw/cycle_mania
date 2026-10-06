import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';

export interface RideSceneProps {
  running: boolean;
  speed: number;
  progress: number;
  zoneColor: string;
  route: 'fjord' | 'alpine' | 'midnight';
  onRenderer?: (name: string) => void;
}

const palettes = {
  fjord: { sky: '#a4d4d7', fog: '#a4cfd0', water: '#3d999d', grass: '#779770', rock: '#64847f', tree: '#275f4e', sun: '#fff0cd', light: '#ffe4b7' },
  alpine: { sky: '#b9d9e9', fog: '#b8ccda', water: '#659dae', grass: '#9ca58a', rock: '#7a858c', tree: '#3a625b', sun: '#fff9e8', light: '#fff2d5' },
  midnight: { sky: '#283c65', fog: '#344b6b', water: '#234d6b', grass: '#536274', rock: '#405873', tree: '#233e51', sun: '#f6c2bd', light: '#e9bcd8' },
};

function roadX(z: number) {
  const t = z * Math.PI * 2 / 900;
  return Math.sin(t) * 33 + Math.sin(t * 3) * 12;
}

// Seeded scenery repeats at the circuit seam, so even long sessions remain seamless.
function randomGenerator(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export default function RideScene(props: RideSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setFailed(false);
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let renderer: THREE.WebGPURenderer | undefined;
    const scene = new THREE.Scene();
    const palette = palettes[props.route];
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.Fog(palette.fog, 170, 920);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 1800);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const geo = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
    const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
      materials.add(material);
      return material;
    };
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = scene) => {
      const object = new THREE.Mesh(geometry, material);
      parent.add(object);
      return object;
    };
    scene.add(new THREE.HemisphereLight(palette.sky, '#455c4b', 2.4));
    const sunshine = new THREE.DirectionalLight(palette.light, props.route === 'midnight' ? 2.1 : 3.2);
    sunshine.position.set(-180, 260, -200);
    scene.add(sunshine);

    const water = mesh(geo(new THREE.PlaneGeometry(8000, 8000)), mat(palette.water, { metalness: 0.3, roughness: 0.4 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -3;
    const shimmer = new THREE.InstancedMesh(geo(new THREE.PlaneGeometry(1, 1)), mat('#c9e9da', { transparent: true, opacity: 0.16, depthWrite: false }), 360);
    const shimmerDummy = new THREE.Object3D();
    const shimmerRandom = randomGenerator(871);
    for (let i = 0; i < 360; i++) {
      const z = shimmerRandom() * 2700 - 1350;
      shimmerDummy.position.set(75 + shimmerRandom() * 170, -2.97, z);
      shimmerDummy.rotation.x = -Math.PI / 2;
      shimmerDummy.scale.set(1 + shimmerRandom() * 8, 0.08 + shimmerRandom() * 0.18, 1);
      shimmerDummy.updateMatrix();
      shimmer.setMatrixAt(i, shimmerDummy.matrix);
    }
    scene.add(shimmer);

    function ribbon(offset: number, width: number, height: number, material: THREE.Material) {
      const positions: number[] = [];
      const indices: number[] = [];
      const count = 1100;
      for (let i = 0; i <= count; i++) {
        const z = -1500 + i / count * 3000;
        const x = roadX(z) + offset;
        positions.push(x - width / 2, height, z, x + width / 2, height, z);
        if (i < count) {
          const k = i * 2;
          indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const geometry = geo(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return mesh(geometry, material);
    }
    ribbon(-170, 350, -0.65, mat(palette.grass));
    ribbon(0, 12.2, -0.09, mat('#b1aea0'));
    ribbon(0, 10.2, 0, mat('#35484a'));
    const roadPaint = mat('#e5e6cf');
    ribbon(-4.6, 0.14, 0.014, roadPaint);
    ribbon(4.6, 0.14, 0.014, roadPaint);
    ribbon(5.8, 0.18, 0.91, mat('#b5c7bc', { metalness: 0.4 }));

    const dummy = new THREE.Object3D();
    const dashes = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.13, 0.025, 3.2)), roadPaint, 300);
    const posts = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.17, 1.05, 0.2)), mat('#c7d2c2'), 200);
    for (let i = 0; i < 300; i++) {
      const z = -1495 + i * 10;
      dummy.position.set(roadX(z), 0.018, z);
      dummy.rotation.set(0, Math.atan2(roadX(z + 0.1) - roadX(z), 0.1), 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < 200; i++) {
      const z = -1495 + i * 15;
      dummy.position.set(roadX(z) + 5.8, 0.42, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    }
    scene.add(dashes, posts);

    // Irregular rings make peaks read as connected, carved rock, rather than cones.
    const rand = randomGenerator(147);
    function mountain(x: number, z: number, radius: number, height: number, seed: number) {
      const random = randomGenerator(seed);
      const sides = 13;
      const rings = 7;
      const vertices: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const base = new THREE.Color(palette.rock);
      const grassColor = new THREE.Color(palette.grass);
      const snow = new THREE.Color(props.route === 'midnight' ? '#9eafc6' : '#e9eee6');
      const angular = Array.from({ length: sides }, () => 0.72 + random() * 0.45);
      for (let ring = 0; ring <= rings; ring++) {
        const fraction = ring / rings;
        const radiusAt = radius * Math.pow(1 - fraction, 0.82);
        for (let side = 0; side < sides; side++) {
          const angle = side / sides * Math.PI * 2;
          const jitter = ring === rings ? 0 : (random() - 0.5) * height * 0.095;
          vertices.push(x + Math.cos(angle) * radiusAt * angular[side] + fraction * radius * 0.13,
            -5 + height * fraction + jitter,
            z + Math.sin(angle) * radiusAt * angular[side]);
          const c = base.clone().lerp(grassColor, Math.max(0, 0.8 - fraction * 1.6));
          if (fraction > (props.route === 'alpine' ? 0.53 : 0.79)) c.lerp(snow, 0.9);
          c.multiplyScalar(0.86 + random() * 0.24);
          colors.push(c.r, c.g, c.b);
          if (ring < rings) {
            const a = ring * sides + side;
            const b = ring * sides + (side + 1) % sides;
            indices.push(a, b, a + sides, b, b + sides, a + sides);
          }
        }
      }
      const geometry = geo(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      mesh(geometry, mountainMaterial);
    }
    const mountainMaterial = mat('#ffffff', { flatShading: true, vertexColors: true, side: THREE.DoubleSide });
    const peaks = Array.from({ length: 22 }, (_, i) => ({
      x: i < 12 ? -125 - rand() * 170 : 265 + rand() * 250,
      z: -450 + (i < 12 ? i / 12 : (i - 12) / 10) * 900,
      radius: 80 + rand() * 95,
      height: 85 + rand() * 210,
      seed: 120 + i * 47,
    }));
    for (const shift of [-900, 0, 900]) {
      for (const peak of peaks) {
        const x = peak.x < 0 ? Math.min(peak.x, -peak.radius * 1.2 - 70) : peak.x;
        mountain(x, peak.z + shift, peak.radius, peak.height, peak.seed);
      }
    }

    // A continuous bank joins the road to the mountains and drops into the fjord.
    const bankPositions: number[] = [];
    const bankIndices: number[] = [];
    for (let i = 0; i <= 750; i++) {
      const z = -1500 + i * 4;
      bankPositions.push(roadX(z) + 6.2, -0.12, z, roadX(z) + 15 + Math.sin(z * 0.08) * 2, -4.5, z);
      if (i < 750) { const k = i * 2; bankIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const bankGeometry = geo(new THREE.BufferGeometry());
    bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bankPositions, 3));
    bankGeometry.setIndex(bankIndices);
    bankGeometry.computeVertexNormals();
    mesh(bankGeometry, mat('#667c68', { flatShading: true, side: THREE.DoubleSide }));

    const treeCount = 1080;
    const foliage = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(1, 1, 7)), mat(palette.tree, { flatShading: true }), treeCount);
    const trunks = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.13, 0.2, 1, 5)), mat('#6e7060'), treeCount / 3);
    const treeRandom = randomGenerator(851);
    const treeTemplates = Array.from({ length: 120 }, () => ({ z: treeRandom() * 900 - 450, side: 9 + Math.pow(treeRandom(), 2) * 58, size: 3 + treeRandom() * 8 }));
    let treeIndex = 0;
    for (const shift of [-900, 0, 900]) {
      for (const tree of treeTemplates) {
        const z = tree.z + shift;
        const x = roadX(z) - tree.side;
        dummy.position.set(x, 0.5, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, tree.size * 0.3, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(treeIndex, dummy.matrix);
        for (let layer = 0; layer < 3; layer++) {
          const width = tree.size * (0.31 - layer * 0.064);
          dummy.position.set(x, tree.size * (0.35 + layer * 0.2) - 0.5, z);
          dummy.scale.set(width, tree.size * 0.65, width);
          dummy.updateMatrix();
          foliage.setMatrixAt(treeIndex * 3 + layer, dummy.matrix);
        }
        treeIndex++;
      }
    }
    scene.add(foliage, trunks);

    // Small red boathouses give the landscape a human scale.
    const houseMaterial = mat('#a9513f');
    const roofMaterial = mat('#344b4e');
    for (const shift of [-900, 0, 900]) {
      for (const zBase of [-170, 340]) {
        const z = zBase + shift;
        const house = mesh(geo(new THREE.BoxGeometry(6, 4.4, 8)), houseMaterial);
        house.position.set(roadX(z) - 16, 1.6, z);
        const roof = mesh(geo(new THREE.ConeGeometry(5.8, 2.8, 4)), roofMaterial);
        roof.position.set(house.position.x, 5.1, z);
        roof.rotation.y = Math.PI / 4;
      }
    }

    const checkpointMaterial = mat('#c9f488', { emissive: '#78b851', emissiveIntensity: 0.7 });
    for (const z of [-1100, -800, -500, -200, 100, 400, 700, 1000]) {
      const gate = new THREE.Group();
      gate.position.set(roadX(z), 0, z);
      gate.rotation.y = Math.atan2(roadX(z + 0.1) - roadX(z), 0.1);
      for (const x of [-5.25, 5.25]) {
        const pole = mesh(geo(new THREE.CylinderGeometry(0.12, 0.12, 6.6, 8)), checkpointMaterial, gate);
        pole.position.set(x, 3.3, 0);
      }
      const cross = mesh(geo(new THREE.BoxGeometry(10.7, 0.22, 0.22)), checkpointMaterial, gate);
      cross.position.y = 6.5;
      scene.add(gate);
    }

    const cyclist = new THREE.Group();
    scene.add(cyclist);
    const dark = mat('#243537', { metalness: 0.35, roughness: 0.55 });
    const kit = mat('#e6ff9a');
    const skin = mat('#d9aa88');
    const helmetMaterial = mat('#ebeee7');
    const frameMaterial = mat('#d6e6de', { metalness: 0.6 });
    const tubeGeometry = geo(new THREE.CylinderGeometry(1, 1, 1, 7));
    const axis = new THREE.Vector3(0, 1, 0);
    function tube(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, parent = cyclist) {
      const object = mesh(tubeGeometry, material, parent);
      alignTube(object, a, b, radius);
      return object;
    }
    function alignTube(object: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
      object.position.copy(a).add(b).multiplyScalar(0.5);
      const direction = b.clone().sub(a);
      object.scale.set(radius, direction.length(), radius);
      object.quaternion.setFromUnitVectors(axis, direction.normalize());
    }
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const wheels: THREE.Mesh[] = [];
    for (const z of [-0.83, 0.83]) {
      const wheel = mesh(geo(new THREE.TorusGeometry(0.49, 0.052, 8, 28)), dark, cyclist);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(0, 0.53, z);
      wheels.push(wheel);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        tube(v(0, 0.53, z), v(0, 0.53 + Math.sin(angle) * 0.45, z + Math.cos(angle) * 0.45), 0.012, frameMaterial);
      }
    }
    const rear = v(0, 0.53, 0.83), front = v(0, 0.53, -0.83), crank = v(0, 0.56, 0.12);
    const seat = v(0, 1.25, 0.38), stem = v(0, 1.2, -0.65);
    for (const [a, b] of [[rear, seat], [rear, crank], [seat, crank], [seat, stem], [stem, crank], [stem, front]]) tube(a, b, 0.037, frameMaterial);
    tube(v(-0.32, 1.35, -0.69), v(0.32, 1.35, -0.69), 0.04, dark);
    const saddle = mesh(geo(new THREE.BoxGeometry(0.24, 0.08, 0.37)), dark, cyclist);
    saddle.position.copy(seat).y += 0.07;
    tube(v(0, 1.52, 0.28), v(0, 1.94, -0.22), 0.23, kit);
    const head = mesh(geo(new THREE.SphereGeometry(0.2, 12, 8)), skin, cyclist);
    head.position.set(0, 2.1, -0.36);
    const helmet = mesh(geo(new THREE.SphereGeometry(0.23, 12, 8)), helmetMaterial, cyclist);
    helmet.position.set(0, 2.24, -0.35);
    helmet.scale.set(1, 0.7, 1.18);
    const legs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      tube(v(side * 0.2, 1.9, -0.22), v(side * 0.3, 1.58, -0.42), 0.09, kit);
      tube(v(side * 0.3, 1.58, -0.42), v(side * 0.31, 1.36, -0.69), 0.065, skin);
      legs.push(tube(v(side * 0.13, 1.45, 0.28), v(side * 0.18, 1, 0), 0.12, dark));
      legs.push(tube(v(side * 0.18, 1, 0), v(side * 0.18, 0.56, 0.1), 0.075, skin));
    }
    const shadow = mesh(geo(new THREE.CircleGeometry(1, 28)), mat('#1f3436', { transparent: true, opacity: 0.27, depthWrite: false }), cyclist);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.7, 1.6, 1);
    shadow.position.y = 0.028;

    const sunMaterial = new THREE.MeshBasicMaterial({ color: palette.sun, fog: false });
    materials.add(sunMaterial);
    const sun = mesh(geo(new THREE.SphereGeometry(17, 24, 16)), sunMaterial);
    const look = new THREE.Vector3();
    let travel = 0;
    let last = 0;
    let pedalPhase = 0;
    const animate = (time: number) => {
      if (disposed || !renderer) return;
      const dt = last ? Math.min((time - last) / 1000, 0.06) : 0;
      last = time;
      const state = live.current;
      if (state.running) travel += Math.max(0, state.speed) / 3.6 * dt;
      const z = 255 - (travel % 900);
      const bikeZ = z - 10;
      cyclist.position.set(roadX(bikeZ) - 2.25, 0.05, bikeZ);
      cyclist.rotation.y = Math.atan2(roadX(bikeZ + 0.1) - roadX(bikeZ), 0.1);
      kit.color.set(state.zoneColor || '#e6ff9a');
      checkpointMaterial.emissiveIntensity = 0.65 + Math.sin(time * 0.0015) * 0.2;
      if (state.running) pedalPhase += dt * Math.min(12, state.speed * 0.24);
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex === 0 ? -1 : 1;
        const phase = pedalPhase + sideIndex * Math.PI;
        const foot = v(side * 0.18, 0.57 + Math.sin(phase) * 0.22, 0.12 + Math.cos(phase) * 0.22);
        const knee = v(side * 0.2, 1.02 + Math.sin(phase) * 0.12, -0.1 + Math.cos(phase) * 0.17);
        alignTube(legs[sideIndex * 2], v(side * 0.13, 1.45, 0.28), knee, 0.12);
        alignTube(legs[sideIndex * 2 + 1], knee, foot, 0.075);
      }
      camera.position.set(roadX(z) - 2.25, state.running ? 4.8 : 6.1, z);
      look.set(roadX(z - 43) + 2, state.running ? 1.8 : 2.5, z - 43);
      camera.lookAt(look);
      sun.position.set(280, 190, z - 850);
      try {
        renderer.render(scene, camera);
      } catch (error) {
        console.error('Ride rendering failed', error);
        setFailed(true);
        return;
      }
      frame = requestAnimationFrame(animate);
    };

    async function initialize() {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        await renderer.init();
        if (disposed) { renderer.dispose(); return; }
        const canvas = renderer.domElement;
        canvas.style.cssText = 'width:100%;height:100%;display:block;position:absolute;inset:0';
        canvas.setAttribute('aria-label', 'Tredimensjonal sykkelrute gjennom norske fjorder og fjell');
        container!.appendChild(canvas);
        const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
        live.current.onRenderer?.(backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2');
        const resize = () => {
          if (!renderer || disposed) return;
          const width = container!.clientWidth || 900;
          const height = container!.clientHeight || 500;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(container!);
        resize();
        frame = requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) {
          console.error('Unable to initialize ride renderer', error);
          setFailed(true);
          live.current.onRenderer?.('2D');
        }
      }
    }
    void initialize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.domElement.remove();
      // init() can finish after React StrictMode cleanup. The async branch disposes it then.
      if (renderer?.hasInitialized()) renderer.dispose();
      scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      scene.clear();
    };
  }, [props.route]);

  return <div ref={host} className="ride-scene" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: palettes[props.route].sky }}>
    {failed && <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#f1f8ea', background: 'linear-gradient(155deg,#719aa0 0%,#376962 45%,#143c38 46%,#152b29 100%)' }}>
      <div style={{ textAlign: 'center', padding: 28 }}><span style={{ fontSize: 54 }}>△</span><p>Fjordruten</p><small>3D er utilgjengelig i denne nettleseren. Økt og målinger fungerer fortsatt.</small></div>
    </div>}
  </div>;
}
