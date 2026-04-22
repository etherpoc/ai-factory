import * as THREE from 'three';
import { MainScene } from './scenes/MainScene.js';

const container = document.getElementById('game')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const threeScene = new THREE.Scene();
threeScene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const mainScene = new MainScene();
mainScene.init(threeScene, camera);

let prev = performance.now();

renderer.setAnimationLoop((now) => {
  const delta = (now - prev) / 1000;
  prev = now;
  mainScene.update(delta);
  renderer.render(threeScene, camera);
});
