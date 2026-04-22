import Phaser from 'phaser';

/**
 * Placeholder main scene. Replaced by Programmer agent with the real game.
 * Boots a readable hello text so the `canvas-boots` e2e criterion passes out of the box.
 */
export class MainScene extends Phaser.Scene {
  constructor() {
    super('Main');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, 'UAF 2D Game — scaffold', {
        color: '#ffffff',
        fontSize: '24px',
      })
      .setOrigin(0.5);

    // Tag a DOM element so the smoke spec can detect that the scene has created.
    const marker = document.createElement('div');
    marker.setAttribute('data-testid', 'scene-ready');
    marker.style.display = 'none';
    document.body.appendChild(marker);
  }
}
