import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DoorContact } from './DoorContact.ts';

/** Exported glTF uses right-handed coordinates; angle signs differ from Unity. */
const DOORS = [...Array.from({ length: 6 }, (_, i) => ({ name: `Door_Hinge_${String(i + 1).padStart(2, '0')}`, angle: i % 2 ? 105 : -105 })),
  { name: 'Front_Left_Hinge', angle: 90 }, { name: 'Front_Right_Hinge', angle: -90 }];

export class ESSModel {
  readonly root: THREE.Group;
  readonly panelSide: 'left' | 'right';
  private readonly doors: { node: THREE.Object3D; target: THREE.Quaternion; requested: THREE.Quaternion; angle: number }[];
  private readonly closed = new THREE.Quaternion();
  private readonly contacts = new Map<THREE.Object3D, DoorContact>();
  private readonly vents: { node: THREE.Object3D; target: THREE.Quaternion }[];
  private constructor(root: THREE.Group, panelSide: 'left' | 'right' = 'left') {
    this.root = root;
    this.panelSide = panelSide;
    this.vents = [1,2,5,6].map(number=>{
      const node=root.getObjectByName(`Vent_Hinge_${String(number).padStart(2,'0')}`);
      if(!node)throw new Error(`Missing vent ${number}`);
      return {node,target:node.quaternion.clone()};
    });
    this.doors = DOORS.map(({ name, angle }) => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`Missing door: ${name}`);
      return { node, angle, target: node.quaternion.clone(), requested: node.quaternion.clone() };
    });
    for (const [left, right] of [[1, 2], [3, 4]]) {
      const nodes = [this.doors[left].node, this.doors[right].node];
      const contact = new DoorContact(nodes[0], nodes[1]);
      for (const node of nodes) this.contacts.set(node, contact);
      for (const vent of this.vents) if (nodes.includes(vent.node.parent!)) this.contacts.set(vent.node, contact);
    }
  }
  static async load(url: string): Promise<ESSModel> {
    const { scene } = await new GLTFLoader().loadAsync(url);
    return new ESSModel(scene);
  }
  clone(panelSide: 'left' | 'right' = this.panelSide): ESSModel {
    const root = this.root.clone(true);
    if (panelSide !== this.panelSide) {
      root.scale.x *= -1;
      const prints = new Map<THREE.Material, THREE.Material>();
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const orientPrint = (material: THREE.Material): THREE.Material => {
          if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) return material;
          if (!prints.has(material)) {
            const copy = material.clone();
            copy.map = material.map.clone();
            copy.map.repeat.x *= -1;
            copy.map.offset.x = 1 - copy.map.offset.x;
            prints.set(material, copy);
          }
          return prints.get(material)!;
        };
        node.material = Array.isArray(node.material) ? node.material.map(orientPrint) : orientPrint(node.material);
      });
    }
    return new ESSModel(root, panelSide);
  }
  toggleVents(): boolean {
    const open=this.vents.some(vent=>vent.target.angleTo(this.closed)<.01);
    for(const vent of this.vents)vent.target.setFromAxisAngle(new THREE.Vector3(1,0,0),open?Math.PI/4:0);
    return open;
  }
  setDoor(name: string, open: boolean): void {
    const door = this.doors.find(d => d.node.name === name);
    if (!door) throw new Error(`Unknown door: ${name}`);
    door.requested.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, open ? THREE.MathUtils.degToRad(door.angle) : 0);
    door.target.copy(door.requested);
    for (const [left, right] of [[1, 2], [3, 4]]) {
      const first = this.doors[left], second = this.doors[right];
      if (door !== first && door !== second) continue;
      const neighbor = door === first ? second : first;
      if (!open) {
        // Closing releases contact, but must not restart the neighbor's opening.
        if (neighbor.requested.angleTo(this.closed) > .01) neighbor.target.copy(neighbor.node.quaternion);
      } else if (neighbor.requested.angleTo(this.closed) > .01) {
        first.target.copy(first.requested);
        second.target.copy(second.requested);
        this.contacts.get(first.node)!.shareOpening(first.target, second.target);
      }
    }
  }
  setAll(open: boolean): void { for (const door of this.doors) this.setDoor(door.node.name, open); }
  toggleObject(object: THREE.Object3D): string | null {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      const ventIndex=this.vents.findIndex(vent=>vent.node===current);
      if(ventIndex>=0){
        const open=this.vents[ventIndex].target.angleTo(this.closed)<.01;
        for(const index of [ventIndex,ventIndex%2 ? ventIndex-1 : ventIndex+1])this.vents[index].target.setFromAxisAngle(new THREE.Vector3(1,0,0),open?Math.PI/4:0);
        return this.vents[ventIndex].node.name;
      }
      const door = this.doors.find(d => d.node === current);
      if (door) {
        const open = door.requested.angleTo(this.closed) < .01;
        this.setDoor(door.node.name, open);
        if (door.node.name.startsWith('Door_Hinge_')) {
          const index = Number(door.node.name.slice(-2));
          this.setDoor(`Door_Hinge_${String(index % 2 ? index + 1 : index - 1).padStart(2, '0')}`, open);
        }
        return door.node.name;
      }
    }
    return null;
  }
  update(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, .1));
    // Substeps keep thin door parts from tunneling, including after a slow frame.
    const steps = Math.max(1, Math.ceil(140 * delta / .25));
    for (let i = 0; i < steps; i++) {
      for (const [joints, speed] of [[this.vents, 90], [this.doors, 140]] as const) {
        for (const joint of joints) {
          const step = THREE.MathUtils.degToRad(speed) * delta / steps;
          const contact = this.contacts.get(joint.node);
          if (contact) contact.move(joint.node, joint.target, step);
          else joint.node.quaternion.rotateTowards(joint.target, step);
        }
      }
    }
  }
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
    this.root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const material of [object.material].flat()) materials.add(material); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.root.removeFromParent();
  }
}
