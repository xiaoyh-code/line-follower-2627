import './style.css';
import './pid-education.css';
import './app-copy.js';
import { localize, registerTranslations, startLanguage } from './i18n.js';
import { setupPidLesson } from './pid-lesson.js';
import { mountPidPractice } from './pid-practice.js';
import { mountBom } from './bom.js';

mountBom(document.getElementById('bom'));
startLanguage();
setupPidLesson(document.getElementById('pid-lesson'));
mountPidPractice(document.getElementById('worksheet'));

const lessonTarget = () => {
  const target = document.getElementById(location.hash.slice(1));
  return target?.closest('.study-layout') ? target : null;
};
let viewportObserver;
let simulatorRequested = false;

async function startSimulator() {
  if (simulatorRequested) return;
  simulatorRequested = true;
  viewportObserver?.disconnect();
  window.removeEventListener('hashchange', onNavigation);
  try {
    const { initializeSimulator } = await import('./main.js');
    await initializeSimulator();
  } catch (error) {
    const message = '未能載入模擬器，請檢查網絡連線並重新整理頁面。';
    registerTranslations({ [message]: 'The simulator could not load. Check your connection and reload.' });
    document.getElementById('stage-state').dataset.state = 'error';
    document.getElementById('state-label').textContent = localize('模擬未能運行');
    const notice = document.getElementById('load-error');
    notice.textContent = localize(message);
    notice.hidden = false;
    console.error(error);
  }
}

function onNavigation() {
  if (!lessonTarget()) startSimulator();
}

const initialTarget = lessonTarget();
if (initialTarget && 'IntersectionObserver' in window) {
  // The target may be a question created above, after the HTML was parsed.
  // Resolve it before observing the large simulator earlier in the document.
  if (window.scrollY === 0) initialTarget.scrollIntoView();
  window.addEventListener('hashchange', onNavigation);
  viewportObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) startSimulator();
  });
  viewportObserver.observe(document.querySelector('.workspace-row'));
} else {
  startSimulator();
}
