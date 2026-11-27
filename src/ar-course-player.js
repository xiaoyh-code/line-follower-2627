import {
  AnimationMixer, Color, DirectionalLight, HemisphereLight, LoopOnce,
  PerspectiveCamera, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { startCourseXR } from './ar-webxr.js';

export function createCoursePlayer(content, { host, overlayRoot, onPlayback, onXRStatus }) {
  const { scene, assembly, clip, span } = content;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  host.append(renderer.domElement);
  const originalBackground = scene.background;
  scene.background = new Color(0xdbe3ef);
  const sky = new HemisphereLight(0xffffff, 0x96a6bb, 2.3);
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(1.3, 1.8, 1);
  scene.add(sky, key);
  const scale = Math.max(.28, span);
  const camera = new PerspectiveCamera(42, 1, .015, 35);
  camera.position.set(scale * .95, scale * 1.17, scale * 1.29);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * .48;
  controls.minDistance = scale * .60;
  controls.maxDistance = scale * 4.5;
  controls.update();
  const mixer = new AnimationMixer(assembly);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play().paused = true;
  mixer.update(0);

  let lastTime;
  let xr;
  let requesting = false;
  let disposed = false;
  let released = false;

  function play() {
    action.reset().play();
    mixer.update(0);
    onPlayback('playing');
  }

  function pause() {
    action.paused = true;
    onPlayback('paused');
  }

  function toggle() {
    if (action.time >= clip.duration) play();
    else if (action.paused) {
      action.paused = false;
      onPlayback('playing');
    } else pause();
  }

  mixer.addEventListener('finished', () => onPlayback('finished'));
  const resize = () => {
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight || renderer.xr.isPresenting) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  renderer.setAnimationLoop((time, frame) => {
    if (disposed) return;
    try {
      xr?.update(frame);
    } catch {
      onXRStatus('failed');
      xr?.end().catch(() => {});
    }
    if (lastTime !== undefined) mixer.update(Math.min(.1, Math.max(0, (time - lastTime) / 1000)));
    lastTime = time;
    renderer.render(scene, camera);
  });

  function release() {
    if (released) return;
    released = true;
    observer.disconnect();
    controls.dispose();
    action.stop();
    mixer.uncacheRoot(assembly);
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    scene.remove(sky, key);
    scene.background = originalBackground;
  }

  async function endXR() {
    await xr?.end();
  }

  async function enterXR(mode) {
    if (requesting || xr || disposed) return;
    requesting = true;
    pause();
    controls.enabled = false;
    try {
      xr = await startCourseXR({
        mode, renderer, scene, camera, assembly, overlayRoot,
        onStatus: value => { if (!disposed) onXRStatus(value); },
        onPlaced: () => { if (!disposed) play(); },
        onEnd: () => {
          xr = null;
          lastTime = undefined;
          if (disposed) release();
          else {
            controls.enabled = true;
            controls.update();
            pause();
            resize();
          }
        },
      });
      if (disposed) await endXR();
    } catch (error) {
      controls.enabled = true;
      lastTime = undefined;
      if (!disposed) resize();
      throw error;
    } finally {
      requesting = false;
      if (disposed && !xr) release();
    }
  }

  function dispose() {
    disposed = true;
    if (xr) endXR().catch(release);
    else if (!requesting) release();
  }

  return { play, toggle, enterXR, endXR, dispose };
}
