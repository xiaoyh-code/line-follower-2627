import './ar-preview.css';
import { localize, onLanguageChange, registerTranslations, t } from './i18n.js';

registerTranslations({
  'AR 預覽': 'AR preview',
  '關閉': 'Close',
  '網頁 3D 可以直接播放。支援 WebXR 嘅裝置會顯示實景 AR 或沉浸 VR。Apple 裝置可以用 Safari 撳圖片開 Quick Look。': 'Play the web 3D replay directly. Supported WebXR devices also offer AR or immersive VR. On Apple devices, tap an image in Safari to open Quick Look.',
  '目前地圖 · 循線重播': 'Current track · line-following replay',
  '由你設定嘅起點出發，用目前嘅調校模擬最多 20 秒。': 'Simulate up to 20 seconds from your chosen start with the current settings.',
  '用 AR 開目前地圖嘅循線重播': 'Open the current track replay in AR',
  '目前套用嘅地圖': 'Currently applied track',
  '用 AR 開原比例車模': 'Open the full-scale car in AR',
  '用 AR 開預設賽道': 'Open the stock track in AR',
  '擺車上枱': 'Place the car on a table',
  '原比例車模約 21 × 21 cm。': 'The car is about 21 × 21 cm at full scale.',
  '預設賽道 · 跑一圈': 'Stock track · one lap',
  '開模型後撳播放，睇約 15 秒循線重播。': 'Press play in the model to watch a 15-second line-following replay.',
  '有粗黑線嘅枱面預設賽道': 'Stock tabletop track with a bold black line',
  '再試一次': 'Try again',
  '儲存 USDZ': 'Save USDZ',
  '正在運算同製作 AR 重播…': 'Simulating and preparing the AR replay…',
  '揀一種方式睇重播。': 'Choose how to view the replay.',
  '未能製作 AR 重播。': 'Could not create the AR replay.',
  '製作目前賽道重播': 'Generate replay for the current track',
  '網頁 3D': 'Web 3D',
  '實景 AR': 'Camera AR',
  '沉浸 VR': 'Immersive VR',
  '暫停重播': 'Pause replay',
  '繼續重播': 'Resume replay',
  '由頭重播': 'Restart replay',
  '再播一次': 'Play again',
  '目前賽道同車嘅 3D 重播': '3D replay of the current track and car',
  '離開實景 AR': 'Exit camera AR',
  '未能開啟網頁 3D。你仍可用 USDZ 睇重播。': 'Could not start web 3D. The replay is still available as a USDZ file.',
  '未能開啟實景或沉浸模式。可以繼續用網頁 3D。': 'Could not enter AR or immersive VR. You can still use web 3D.',
  '瀏覽器未能打包 USDZ，網頁 3D 重播已準備好。': 'Could not package USDZ. The web 3D replay is ready.',
});

const xrMessages = {
  scanning: ['慢慢移動裝置，搵枱面或地面。', 'Move your device slowly to find a table or the floor.'],
  surface: ['撳圓圈擺低賽道。', 'Tap the ring to place the track.'],
  placed: ['正播放循線。再撳可以由頭重播。', 'Replay playing. Tap again to restart.'],
  viewing: ['用控制器選取可以由頭重播。', 'Select with your controller to restart the replay.'],
};

export function setupArPreview() {
  const dialog = document.getElementById('ar-preview');
  const openButton = document.getElementById('open-ar');
  const current = document.getElementById('ar-current');
  const name = document.getElementById('ar-course-name');
  const parameterLabel = document.getElementById('ar-params');
  const status = document.getElementById('ar-status');
  const generate = document.getElementById('ar-generate');
  const retry = document.getElementById('ar-retry');
  const save = document.getElementById('ar-save');
  const launch = dialog.querySelector('[data-custom-ar]');
  const poster = launch.querySelector('img');
  const playOptions = document.getElementById('ar-play-options');
  const watch = document.getElementById('ar-watch');
  const enterAr = document.getElementById('ar-enter-ar');
  const enterVr = document.getElementById('ar-enter-vr');
  const inline = document.getElementById('ar-inline');
  const host = document.getElementById('ar-canvas');
  const toggle = document.getElementById('ar-toggle');
  const restart = document.getElementById('ar-restart');
  const webStatus = document.getElementById('ar-web-status');
  const overlayRoot = document.getElementById('ar-xr-overlay');
  const overlayStatus = document.getElementById('ar-xr-status');
  const exitXR = document.getElementById('ar-exit-xr');
  let scene;
  let previewUrl;
  let modelUrl;
  let pending;
  let exportedKey;
  let summary;
  let message = '';
  let content;
  let player;
  let createPlayer;
  let xrState;
  let webMessage = '';

  function supportsXR(mode, button) {
    navigator.xr?.isSessionSupported?.(mode).then(supported => {
      button.hidden = !supported;
    }).catch(() => {});
  }
  supportsXR('immersive-ar', enterAr);
  supportsXR('immersive-vr', enterVr);

  function translate() {
    if (scene) name.textContent = scene.course?.generatedName
      ? localize(scene.course.generatedName) : scene.course?.name || localize('預設環線');
    const statistics = summary ? t(
      `模擬 ${summary.duration} 秒 · 失線 ${summary.lossCount} 次。`,
      `${summary.duration} s simulated · Line losses ${summary.lossCount}.`,
    ) + ' ' : '';
    status.textContent = statistics + localize(message);
    webStatus.textContent = localize(webMessage);
    overlayStatus.textContent = xrMessages[xrState] ? t(...xrMessages[xrState]) : '';
  }

  function stopPlayer() {
    player?.dispose();
    player = null;
    inline.hidden = true;
    xrState = null;
  }

  function discardReplay() {
    pending?.controller.abort();
    pending = null;
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    stopPlayer();
    content?.dispose();
    content = null;
    modelUrl = exportedKey = summary = null;
    launch.hidden = save.hidden = retry.hidden = playOptions.hidden = true;
    launch.removeAttribute('href');
    save.removeAttribute('href');
    webMessage = '';
  }

  async function prepare() {
    if (!scene) return;
    const { course, model, readParams } = scene;
    const params = readParams();
    const key = JSON.stringify(params);
    if (key === exportedKey || key === pending?.key) return;
    discardReplay();
    generate.hidden = true;
    const job = { key, controller: new AbortController() };
    const { signal } = job.controller;
    pending = job;
    parameterLabel.textContent = `P = ${params.p} · I = ${params.i} · D = ${params.d} · B = ${params.speed}`;
    message = '正在運算同製作 AR 重播…';
    translate();
    try {
      const [{ createArCourseScene, encodeArCourseScene }, { recordArCourseReplay }, playerModule] = await Promise.all([
        import('./ar-course-export.js'), import('./ar-course-replay.js'),
        import('./ar-course-player.js'),
      ]);
      if (signal.aborted) return;
      const replay = await recordArCourseReplay({ course, physical: model?.physical, params, signal });
      if (signal.aborted) return;
      const prepared = await createArCourseScene({
        course, model, startOffsetMm: params.startOffsetMm, frames: replay.frames,
      });
      if (signal.aborted) {
        prepared.dispose();
        return;
      }
      // Keep the same scene and animation for inline WebGL and WebXR.
      content = prepared;
      createPlayer = playerModule.createCoursePlayer;
      try {
        const bytes = await encodeArCourseScene(prepared);
        if (signal.aborted) return;
        modelUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/vnd.usdz+zip' }));
        launch.href = save.href = modelUrl;
        launch.hidden = save.hidden = false;
      } catch (error) {
        if (signal.aborted) return;
        webMessage = '瀏覽器未能打包 USDZ，網頁 3D 重播已準備好。';
        console.error(error);
      }
      exportedKey = key;
      playOptions.hidden = false;
      summary = { duration: Number(replay.duration.toFixed(2)), lossCount: replay.lossCount };
      message = '揀一種方式睇重播。';
    } catch (error) {
      if (signal.aborted) return;
      message = '未能製作 AR 重播。';
      retry.hidden = false;
      console.error(error);
    } finally {
      if (pending === job) {
        pending = null;
        translate();
      }
    }
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    if (scene?.course || scene?.model || exportedKey) prepare();
  }

  function showPlayback() {
    if (!content) return null;
    inline.hidden = false;
    try {
      player ??= createPlayer(content, {
        host, overlayRoot,
        onPlayback: state => {
          const labels = { playing: '暫停重播', paused: '繼續重播', finished: '再播一次' };
          toggle.textContent = localize(labels[state]);
        },
        onXRStatus: state => {
          xrState = state;
          if (state === 'failed') webMessage = '未能開啟實景或沉浸模式。可以繼續用網頁 3D。';
          translate();
        },
      });
      return player;
    } catch (error) {
      inline.hidden = true;
      webMessage = '未能開啟網頁 3D。你仍可用 USDZ 睇重播。';
      translate();
      console.error(error);
      return null;
    }
  }

  function enterXR(mode) {
    const activePlayer = showPlayback();
    if (!activePlayer) return;
    webMessage = '';
    translate();
    activePlayer.enterXR(mode).catch(() => {
      if (activePlayer !== player) return;
      webMessage = '未能開啟實景或沉浸模式。可以繼續用網頁 3D。';
      translate();
    });
  }

  openButton.addEventListener('click', open);
  generate.addEventListener('click', prepare);
  retry.addEventListener('click', prepare);
  watch.addEventListener('click', () => {
    webMessage = '';
    translate();
    const activePlayer = showPlayback();
    if (activePlayer) {
      inline.scrollIntoView({ block: 'nearest' });
      activePlayer.play();
    }
  });
  enterAr.addEventListener('click', () => enterXR('immersive-ar'));
  enterVr.addEventListener('click', () => enterXR('immersive-vr'));
  toggle.addEventListener('click', () => player?.toggle());
  restart.addEventListener('click', () => player?.play());
  exitXR.addEventListener('click', () => player?.endXR().catch(() => {}));
  function checkFragment() {
    if (location.hash === '#ar-preview') open();
  }
  window.addEventListener('hashchange', checkFragment);
  dialog.addEventListener('close', () => {
    stopPlayer();
    if (location.hash === '#ar-preview') openButton.focus();
  });
  onLanguageChange(translate);
  checkFragment();

  return ({ course, model, readParams }) => {
    discardReplay();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    message = '';
    parameterLabel.textContent = '';
    scene = { course, model, readParams };
    current.hidden = false;
    generate.hidden = Boolean(course || model);
    name.toggleAttribute('data-no-i18n', Boolean(course?.name && !course.generatedName));
    if (course) previewUrl = URL.createObjectURL(new Blob([course.svg], { type: 'image/svg+xml' }));
    poster.src = previewUrl || '/ar/tabletop-lap-contrast.webp';
    translate();
    if (dialog.open && (course || model)) prepare();
  };
}
