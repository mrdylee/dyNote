import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';

/** Kinematic contact for one neighboring pair; no mass/gravity simulation. */
export class DoorContact {
  private readonly bodies: { mesh: THREE.Mesh; local: THREE.Box3; bounds: THREE.Box3; box: OBB }[][];
  private readonly nodes: THREE.Object3D[];
  private revision = 0;
  private readonly blocked = new Map<THREE.Object3D, { target: THREE.Quaternion; revision: number }>();
  private readonly scale = new THREE.Vector3();
  constructor(first: THREE.Object3D, second: THREE.Object3D) {
    this.nodes = [first, second];
    this.bodies = this.nodes.map(node => {
      const meshes: THREE.Mesh[] = [];
      node.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child); });
      return meshes.map(mesh => {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        return { mesh, local: mesh.geometry.boundingBox!.clone(), bounds: new THREE.Box3(), box: new OBB() };
      });
    });
  }
  private intersects(): boolean {
    for (const node of this.nodes) node.updateWorldMatrix(true, true);
    for (const body of this.bodies) for (const { mesh, local, bounds, box } of body) {
      const matrix = mesh.matrixWorld;
      this.scale.setFromMatrixScale(matrix);
      local.getCenter(box.center).applyMatrix4(matrix);
      local.getSize(box.halfSize).multiply(this.scale).multiplyScalar(.5).addScalar(.003);
      // Normalize columns without signed half-sizes: right leaves are mirrored.
      box.rotation.setFromMatrix4(matrix);
      for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) {
        box.rotation.elements[column * 3 + row] /= this.scale.getComponent(column);
      }
      bounds.copy(local).applyMatrix4(matrix).expandByScalar(.006);
    }
    return this.bodies[0].some(a => this.bodies[1].some(b =>
      a.bounds.intersectsBox(b.bounds) && a.box.intersectsOBB(b.box)));
  }
  /** Give both requested leaves the same safe opening, regardless of click order. */
  shareOpening(first: THREE.Quaternion, second: THREE.Quaternion): void {
    const closed = new THREE.Quaternion();
    const desired = [first.clone(), second.clone()];
    const saved = this.nodes.map(node => node.quaternion.clone());
    const steps = Math.ceil(Math.max(...desired.map(q => q.angleTo(closed))) / THREE.MathUtils.degToRad(.25));
    const pose = (fraction: number): void => {
      this.nodes.forEach((node, i) => node.quaternion.slerpQuaternions(closed, desired[i], fraction));
    };
    let safe = 0;
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      pose(fraction);
      if (this.intersects()) {
        let high = fraction;
        for (let i = 0; i < 12; i++) {
          const mid = (safe + high) / 2;
          pose(mid);
          if (this.intersects()) high = mid; else safe = mid;
        }
        break;
      }
      safe = fraction;
    }
    first.slerpQuaternions(closed, desired[0], safe);
    second.slerpQuaternions(closed, desired[1], safe);
    this.nodes.forEach((node, i) => {
      node.quaternion.copy(saved[i]);
      node.updateWorldMatrix(true, true);
    });
  }
  move(node: THREE.Object3D, target: THREE.Quaternion, step: number): void {
    if (node.quaternion.equals(target) || node.quaternion.angleTo(target) < 1e-8) return;
    const blocked = this.blocked.get(node);
    if (blocked?.revision === this.revision && blocked.target.equals(target)) return;
    const start = node.quaternion.clone();
    const end = start.clone().rotateTowards(target, step);
    node.quaternion.copy(end);
    const contact = this.intersects();
    if (contact) {
      let low = 0, high = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        node.quaternion.slerpQuaternions(start, end, mid);
        if (this.intersects()) high = mid; else low = mid;
      }
      node.quaternion.slerpQuaternions(start, end, low);
    }
    if (!start.equals(node.quaternion)) this.revision++;
    if (contact) this.blocked.set(node, { target: target.clone(), revision: this.revision });
    else this.blocked.delete(node);
  }
}
