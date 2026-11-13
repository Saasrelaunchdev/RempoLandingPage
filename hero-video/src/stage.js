// The renderer, the lights and the day-to-night change. Shared by the story and the stills check.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { lerp } from './anim.js';

export const W = 1920, H = 1080;

export function makeStage(canvas) {
  const q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.get('aa') !== '0', alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  const camera = new THREE.PerspectiveCamera(26, W / H, 0.5, 400);

  const hemi = new THREE.HemisphereLight('#ffffff', '#c9e6c0', 0.62);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 2.9);
  sun.castShadow = true;
  const sm = +(q.get('shadow') || 2048);
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  // Night: how dark the world is (0 day, 1 night). The windows, lamps and headlights glow as it rises.
  const glow = { windows: [], lamps: [], vans: [], shops: [] };
  function setNight(n, focus = new THREE.Vector3(), span = 26) {
    hemi.intensity = lerp(0.62, 0.42, n);
    hemi.color.set('#ffffff').lerp(new THREE.Color('#7f95d6'), n);
    hemi.groundColor.set('#c9e6c0').lerp(new THREE.Color('#1b2a4e'), n);
    sun.intensity = lerp(2.9, 0.5, n);
    sun.color.set('#ffffff').lerp(new THREE.Color('#9db4ff'), n);
    scene.environmentIntensity = lerp(0.38, 0.16, n);
    // the sun (or the moon) stands over the part of the world on screen, and its shadow box covers it
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(new THREE.Vector3(-14, 30, 16));
    const c = sun.shadow.camera;
    c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 1; c.far = 90;
    c.updateProjectionMatrix();
    for (const m of glow.windows) {
      m.emissive.set('#ffc865');
      m.emissiveIntensity = n * (m.userData.on ?? 1) * 1.25;
      m.color.set('#c9dcf3').lerp(new THREE.Color('#ffe3a3'), n * (m.userData.on ?? 1));
    }
    for (const l of glow.lamps) {
      l.bulb.emissiveIntensity = n * 2.2;
      l.pool.opacity = n * 0.28;
    }
    for (const v of glow.vans) {
      const on = v.userData.lightsOn ?? n;
      v.lights.forEach((m, i) => { m.emissiveIntensity = i % 2 === 0 ? 0.15 + on * 2.2 : 0.1 + on * 1.4; });
      v.beamMat.opacity = on * 0.16;
    }
    for (const s of glow.shops) {
      const on = s.userData.on ?? 1;
      s.office.emissive.set('#ffc865');
      s.office.emissiveIntensity = n * on * 1.3;
      s.office.color.set('#c9dcf3').lerp(new THREE.Color('#ffe3a3'), n * on);
      s.lamp.emissiveIntensity = n * on * 2;
      s.signMat.emissiveIntensity = 0.08 + n * 0.55;
    }
  }

  // split: [leftCamera, rightCamera] renders two views side by side (each half is W/2 wide)
  const state = { split: null };
  function render() {
    if (!state.split) { renderer.setViewport(0, 0, W, H); renderer.render(scene, camera); return; }
    renderer.setScissorTest(true);
    state.split.forEach((c, i) => {
      renderer.setViewport(i * W / 2, 0, W / 2, H);
      renderer.setScissor(i * W / 2, 0, W / 2, H);
      renderer.render(scene, c);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  }
  return { renderer, scene, camera, sun, hemi, glow, setNight, render, state };
}
