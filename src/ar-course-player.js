import {
  AnimationMixer, Color, DirectionalLight, HemisphereLight, LoopOnce,
  PerspectiveCamera, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { controlFields } from './control-fields.js';
import { startCourseXR } from './ar-webxr.js';
import { createXrCourseControls } from './ar-xr-controls.js';

export function createCoursePlayer(content, { host, overlayRoot, onPlayback, onXRStatus, tuningOptions }) {
  const { scene, assembly, clip, span, createClip } = content;
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
  let action = makeAction(clip);
  rewind();

  let lastTime;
  let xr;
  let tuning;
  let requesting = false;
  let disposed = false;
  let released = false;

  function makeAction(animation) {
    const next = mixer.clipAction(animation);
    next.setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
    return next;
  }

  function rewind() {
    action.reset().play().paused = true;
    mixer.update(0);
  }

  function useClip(animation) {
    const previous = action.getClip();
    action.stop();
    mixer.uncacheAction(previous);
    action = makeAction(animation);
    rewind();
  }

  function play() {
    rewind();
    action.paused = false;
    onPlayback('playing');
    tuning?.setPlayback('playing');
  }

  function pause() {
    action.paused = true;
    onPlayback('paused');
  }

  function toggle() {
    if (action.time >= action.getClip().duration) play();
    else if (action.paused) {
      action.paused = false;
      onPlayback('playing');
    } else pause();
  }

  mixer.addEventListener('finished', () => {
    onPlayback('finished');
    tuning?.setPlayback('finished');
  });
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

  function createTuning({ params: initialParams, lossCount: initialLossCount, createRecorder }) {
    let params = initialParams;
    let lossCount = initialLossCount;
    let revision = 0;
    let playedRevision = 0;
    let recorder;
    let timer;
    let recording = false;
    let closed = false;
    const panel = createXrCourseControls({
      span, params,
      ranges: Object.fromEntries(controlFields.map(field => [field.key, field])),
      onChange: next => {
        params = { ...params, ...next };
        revision++;
        rewind();
        schedule();
      },
      onReplay: replay,
      onExit: () => endXR().catch(console.error),
    });

    function schedule() {
      panel.setRunState('running');
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!recording) run();
      }, 120);
    }

    function replay() {
      if (playedRevision === revision) play();
      else if (!recording && timer === undefined) schedule();
    }

    async function run() {
      const requested = revision;
      recording = true;
      try {
        recorder ??= createRecorder();
        const result = await recorder.record(params);
        if (closed || requested !== revision) return;
        useClip(createClip(result.frames));
        lossCount = result.lossCount;
        playedRevision = requested;
        play();
      } catch (error) {
        if (closed) return;
        recorder?.dispose();
        recorder = null;
        if (requested === revision) {
          panel.setRunState('failed');
          console.error(error);
        }
      } finally {
        recording = false;
        if (!closed && requested !== revision && timer === undefined) run();
      }
    }

    return {
      panel, replay,
      setPlayback: state => panel.setRunState(state, lossCount),
      dispose() {
        closed = true;
        clearTimeout(timer);
        recorder?.dispose();
        panel.dispose();
      },
    };
  }

  async function enterXR(mode) {
    if (requesting || xr || disposed) return;
    requesting = true;
    pause();
    controls.enabled = false;
    try {
      if (mode === 'immersive-vr' && tuningOptions) tuning = createTuning(tuningOptions);
      xr = await startCourseXR({
        mode, renderer, scene, camera, assembly, overlayRoot,
        courseControls: tuning?.panel,
        onStatus: value => { if (!disposed) onXRStatus(value); },
        onPlaced: () => {
          if (disposed) return;
          if (tuning) tuning.replay();
          else play();
        },
        onEnd: () => {
          xr = null;
          lastTime = undefined;
          tuning?.dispose();
          tuning = null;
          if (disposed) release();
          else {
            if (action.getClip() !== clip) useClip(clip);
            controls.enabled = true;
            controls.update();
            pause();
            resize();
          }
        },
      });
      if (disposed) await endXR();
    } catch (error) {
      tuning?.dispose();
      tuning = null;
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
