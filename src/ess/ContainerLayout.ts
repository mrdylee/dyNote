import * as THREE from 'three';

export const LINK_PANEL_SIDES = ['left', 'right', 'right', 'left', 'left', 'right'] as const;

/** Back-to-back four-unit group, plus a separate front-facing L/R pair. */
export function arrangeContainers(roots: THREE.Object3D[]): THREE.Box3 {
  const gap = .5 * .3048;
  const depth = new THREE.Box3().setFromObject(roots[0]).getSize(new THREE.Vector3()).z;
  const bounds = new THREE.Box3();
  roots.forEach((root, index) => {
    root.position.set(0, 0, 0);
    const row = Math.floor(index / 2);
    root.rotation.set(0, row === 1 ? Math.PI : 0, 0);
    root.updateWorldMatrix(true, true);
    const body = new THREE.Box3().setFromObject(root);
    root.position.set(index % 2 ? gap / 2 - body.min.x : -gap / 2 - body.max.x,
      0, row === 1 ? -gap / 2 - body.max.z : gap / 2 + (row === 2 ? depth + 4 : 0) - body.min.z);
    root.updateWorldMatrix(true, true);
    bounds.union(new THREE.Box3().setFromObject(root));
  });
  return bounds;
}
