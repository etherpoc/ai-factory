import * as THREE from 'three';

/**
 * Placeholder main scene. Replaced by Programmer agent with the real game.
 * Boots a visible mesh and exposes DOM markers so smoke tests pass out of the box.
 */
export class MainScene {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private cube!: THREE.Mesh;
  private playerProxy!: HTMLElement;

  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;

    // Ambient + directional light
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    scene.add(dir);

    // Placeholder cube (represents the player)
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff });
    this.cube = new THREE.Mesh(geo, mat);
    scene.add(this.cube);

    camera.position.set(0, 3, 8);
    camera.lookAt(0, 0, 0);

    // DOM: scene-ready marker
    const marker = document.createElement('div');
    marker.setAttribute('data-testid', 'scene-ready');
    marker.style.display = 'none';
    document.body.appendChild(marker);

    // DOM: player proxy (required contract for gameplay.spec.ts)
    this.playerProxy = document.createElement('div');
    this.playerProxy.setAttribute('data-testid', 'player');
    this.playerProxy.setAttribute('data-x', '0');
    this.playerProxy.style.display = 'none';
    document.body.appendChild(this.playerProxy);
  }

  update(_delta: number): void {
    this.cube.rotation.y += 0.01;
    // Sync DOM proxy with mesh position
    this.playerProxy.setAttribute('data-x', String(Math.round(this.cube.position.x)));
  }

  dispose(): void {
    if (this.cube.geometry) this.cube.geometry.dispose();
    if (Array.isArray(this.cube.material)) {
      this.cube.material.forEach((m) => m.dispose());
    } else {
      (this.cube.material as THREE.Material).dispose();
    }
    this.scene.remove(this.cube);
  }
}
