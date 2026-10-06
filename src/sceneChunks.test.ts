import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { partitionInstances } from './sceneChunks';
import { routeAt } from './realTerrain';

describe('spatial scenery batches', () => {
  it('preserves transforms, colors, materials and shadows without sharing instance bounds', () => {
    const geometry = new THREE.BoxGeometry(2, 3, 4);
    const material = new THREE.MeshStandardMaterial();
    const source = new THREE.InstancedMesh(geometry, material, 4);
    source.position.set(25, 10, -15);
    source.rotation.y = .4;
    source.scale.set(2, 1, 3);
    source.castShadow = source.receiveShadow = true;
    source.layers.set(3);
    source.renderOrder = 5;
    const matrices = [-220, -5, 10, 220].map((x, i) => new THREE.Matrix4().compose(
      new THREE.Vector3(x, i * 3, x / 2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * .3),
      new THREE.Vector3(1 + i, 2, .7),
    ));
    const colors = matrices.map((_, i) => new THREE.Color().setRGB(i / 4, .4, .8));
    matrices.forEach((matrix, i) => { source.setMatrixAt(i, matrix); source.setColorAt(i, colors[i]!); });
    source.computeBoundingSphere();
    const originalBounds = source.boundingSphere!.clone();
    const chunks = partitionInstances(source, 192);
    expect(chunks).toHaveLength(4);
    expect(chunks.reduce((sum, chunk) => sum + chunk.count, 0)).toBe(4);
    const parent = new THREE.Group();
    parent.position.set(-40, 12, 8);
    parent.add(source, ...chunks);
    parent.updateMatrixWorld(true);
    chunks.forEach((chunk, i) => {
      expect(chunk.geometry).toBe(geometry);
      expect(chunk.material).toBe(material);
      expect(chunk.matrixWorld.equals(source.matrixWorld)).toBe(true);
      expect(chunk.castShadow && chunk.receiveShadow && chunk.frustumCulled).toBe(true);
      expect(chunk.layers.mask).toBe(source.layers.mask);
      expect(chunk.renderOrder).toBe(5);
      const actual = new THREE.Matrix4(); chunk.getMatrixAt(0, actual);
      const original = new THREE.Matrix4(); source.getMatrixAt(i, original);
      expect(actual.equals(original)).toBe(true);
      const actualColor = new THREE.Color(); chunk.getColorAt(0, actualColor);
      expect(actualColor.r).toBeCloseTo(colors[i]!.r);
      expect(actualColor.g).toBeCloseTo(colors[i]!.g);
      expect(chunk.boundingSphere).not.toBe(source.boundingSphere);
      expect(chunk.boundingBox).not.toBeNull();
    });
    expect(source.boundingSphere!.equals(originalBounds)).toBe(true);
  });

  it('supports manually managed object matrices and drops only fully collapsed slots', () => {
    const source = new THREE.InstancedMesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial(), 3);
    source.matrixAutoUpdate = false;
    source.matrix.makeTranslation(3, 4, 5);
    source.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
    source.setMatrixAt(1, new THREE.Matrix4().makeScale(1, 1, 0));
    source.setMatrixAt(2, new THREE.Matrix4().makeTranslation(200, 0, 0));
    const chunks = partitionInstances(source);
    expect(chunks.reduce((sum, chunk) => sum + chunk.count, 0)).toBe(2);
    for (const chunk of chunks) {
      chunk.updateMatrixWorld(true);
      expect(chunk.matrixAutoUpdate).toBe(false);
      expect(chunk.matrixWorld.equals(source.matrix)).toBe(true);
      expect(chunk.instanceColor).toBeNull();
    }
    source.count = 0;
    expect(partitionInstances(source)).toEqual([]);
    expect(() => partitionInstances(source, 0)).toThrow(RangeError);
  });

  it('culls offscreen sections of the Vestland circuit instead of submitting the entire forest', () => {
    const source = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 12, 4), new THREE.MeshBasicMaterial(), 1400);
    for (let i = 0; i < source.count; i++) {
      const p = routeAt(i / source.count, -18);
      source.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y + 6, p.z));
    }
    const chunks = partitionInstances(source);
    const p = routeAt(0, 1.3), ahead = routeAt(22 / 8400, 1.3);
    const camera = new THREE.PerspectiveCamera(67, 16 / 9, .08, 14000);
    camera.position.set(p.x, p.y + 1.72, p.z);
    camera.lookAt(ahead.x, ahead.y + 1.55, ahead.z);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(frustum.intersectsObject(source)).toBe(true);
    const visible = chunks.filter(chunk => frustum.intersectsObject(chunk));
    const submitted = visible.reduce((sum, chunk) => sum + chunk.count, 0);
    expect(submitted).toBeGreaterThan(0);
    expect(submitted).toBeLessThan(source.count * .5);
    // Visible chunk bounds always enclose every transformed instance box.
    for (const chunk of visible) for (let i = 0; i < chunk.count; i++) {
      const matrix = new THREE.Matrix4(); chunk.getMatrixAt(i, matrix);
      const bounds = source.geometry.boundingBox!.clone().applyMatrix4(matrix);
      expect(chunk.boundingBox!.containsBox(bounds)).toBe(true);
    }
  });
});
