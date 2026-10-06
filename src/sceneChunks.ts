import * as THREE from 'three/webgpu';

/**
 * Split static scenery into local X/Z cells so frustum culling can reject parts
 * of a large instanced mesh. Returned meshes replace source under the same
 * parent. Geometry and materials remain shared and owned by the caller; dispose
 * the removed source's instance buffers with source.dispose(), not its geometry.
 */
export function partitionInstances(source: THREE.InstancedMesh, cellSize = 192): THREE.InstancedMesh[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be positive and finite');
  const cells = new Map<string, number[]>();
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < source.count; index++) {
    source.getMatrixAt(index, matrix);
    const e = matrix.elements;
    if (!e.every(Number.isFinite)) throw new RangeError('Instance matrices must be finite');
    // Hidden guardrail slots use an entirely collapsed transform. Keep planar
    // instances (one zero axis), which may still contain visible geometry.
    if (e[0] === 0 && e[1] === 0 && e[2] === 0 &&
        e[4] === 0 && e[5] === 0 && e[6] === 0 &&
        e[8] === 0 && e[9] === 0 && e[10] === 0) continue;
    const key = `${Math.floor(e[12]! / cellSize)},${Math.floor(e[14]! / cellSize)}`;
    const indices = cells.get(key);
    if (indices) indices.push(index);
    else cells.set(key, [index]);
  }

  const color = new THREE.Color();
  return Array.from(cells, ([cell, indices]) => {
    const chunk = new THREE.InstancedMesh(source.geometry, source.material, indices.length);
    chunk.name = `${source.name || 'scenery'}:${cell}`;
    chunk.position.copy(source.position);
    chunk.quaternion.copy(source.quaternion);
    chunk.scale.copy(source.scale);
    chunk.matrix.copy(source.matrix);
    chunk.matrixWorld.copy(source.matrixWorld);
    chunk.matrixAutoUpdate = source.matrixAutoUpdate;
    chunk.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    chunk.layers.mask = source.layers.mask;
    chunk.visible = source.visible;
    chunk.castShadow = source.castShadow;
    chunk.receiveShadow = source.receiveShadow;
    chunk.renderOrder = source.renderOrder;
    chunk.frustumCulled = true;
    chunk.instanceMatrix.setUsage(source.instanceMatrix.usage);
    for (const [target, original] of indices.entries()) {
      source.getMatrixAt(original, matrix);
      chunk.setMatrixAt(target, matrix);
      if (source.instanceColor) {
        source.getColorAt(original, color);
        chunk.setColorAt(target, color);
      }
    }
    chunk.instanceMatrix.needsUpdate = true;
    if (chunk.instanceColor) {
      chunk.instanceColor.setUsage(source.instanceColor!.usage);
      chunk.instanceColor.needsUpdate = true;
    }
    // These bounds belong to each chunk, never to the original whole-route mesh.
    chunk.computeBoundingBox();
    chunk.computeBoundingSphere();
    return chunk;
  });
}
