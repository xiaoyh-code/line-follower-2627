import './ar-preview.css';
import { localize, onLanguageChange, registerTranslations } from './i18n.js';

registerTranslations({
  'AR 預覽': 'AR preview',
  '關閉': 'Close',
  '用 iPhone Safari 撳圖片，喺 Quick Look 揀 AR，再將鏡頭對住枱面或地面。': 'In Safari on iPhone, tap an image, choose AR in Quick Look, and point your camera at a table or the floor.',
  '目前地圖同車模': 'Current track and car',
  '靜態預覽會將車模擺喺你設定嘅起點同方向。': 'The static preview places the car at your chosen starting point and heading.',
  '用 AR 開目前地圖同車模': 'Open the current track and car in AR',
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
  '正在準備 AR 模型…': 'Preparing the AR model…',
  '已準備好。撳地圖開 AR。': 'Ready. Tap the track image to open AR.',
  '未能製作 AR 模型。': 'Could not create the AR model.',
});

export function setupArPreview() {
  const dialog = document.getElementById('ar-preview');
  const openButton = document.getElementById('open-ar');
  const current = document.getElementById('ar-current');
  const name = document.getElementById('ar-course-name');
  const status = document.getElementById('ar-status');
  const retry = document.getElementById('ar-retry');
  const save = document.getElementById('ar-save');
  const launch = dialog.querySelector('[data-custom-ar]');
  const poster = launch.querySelector('img');
  let scene;
  let previewUrl;
  let modelUrl;
  let pending;
  let message = '';

  function translate() {
    if (scene) name.textContent = scene.course?.generatedName
      ? localize(scene.course.generatedName) : scene.course?.name || localize('預設環線');
    status.textContent = localize(message);
  }

  async function prepare() {
    if (!scene || modelUrl || pending) return;
    const snapshot = scene;
    pending = snapshot;
    retry.hidden = true;
    message = '正在準備 AR 模型…';
    translate();
    try {
      const { exportArCourse } = await import('./ar-course-export.js');
      const bytes = await exportArCourse(snapshot);
      if (scene !== snapshot) return;
      modelUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/vnd.usdz+zip' }));
      launch.href = save.href = modelUrl;
      launch.hidden = save.hidden = false;
      message = '已準備好。撳地圖開 AR。';
    } catch (error) {
      if (scene !== snapshot) return;
      message = '未能製作 AR 模型。';
      retry.hidden = false;
      console.error(error);
    } finally {
      if (pending === snapshot) pending = null;
      translate();
    }
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    prepare();
  }

  openButton.addEventListener('click', open);
  retry.addEventListener('click', prepare);
  function checkFragment() {
    if (location.hash === '#ar-preview') open();
  }
  window.addEventListener('hashchange', checkFragment);
  dialog.addEventListener('close', () => {
    if (location.hash === '#ar-preview') openButton.focus();
  });
  onLanguageChange(translate);
  checkFragment();

  return ({ course, model, startOffsetMm }) => {
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    modelUrl = previewUrl = null;
    pending = null;
    message = '';
    launch.hidden = save.hidden = retry.hidden = true;
    launch.removeAttribute('href');
    save.removeAttribute('href');
    scene = course || model ? { course, model, startOffsetMm } : null;
    current.hidden = !scene;
    name.toggleAttribute('data-no-i18n', Boolean(course?.name && !course.generatedName));
    if (course) previewUrl = URL.createObjectURL(new Blob([course.svg], { type: 'image/svg+xml' }));
    if (scene) poster.src = previewUrl || '/ar/tabletop-lap-contrast.webp';
    else poster.removeAttribute('src');
    translate();
    if (dialog.open) prepare();
  };
}
