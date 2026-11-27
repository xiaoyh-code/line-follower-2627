import './controller-panel.css';
import { registerTranslations } from './i18n.js';

registerTranslations({
  '展開設定': 'Show settings',
  '收起設定面板': 'Collapse settings panel',
});

export function setupControllerPanel(workspace) {
  const show = workspace.querySelector('#show-controller');
  const collapseButtons = workspace.querySelectorAll('[data-collapse-controller]');

  function setCollapsed(collapsed) {
    workspace.toggleAttribute('data-settings-collapsed', collapsed);
    show.hidden = !collapsed;
    for (const button of [show, ...collapseButtons]) {
      button.setAttribute('aria-expanded', String(!collapsed));
    }

    const target = collapsed ? show : workspace.querySelector('aside:not([hidden]) [data-collapse-controller]');
    target.focus();
  }

  for (const button of collapseButtons) {
    button.addEventListener('click', () => setCollapsed(true));
  }
  show.addEventListener('click', () => setCollapsed(false));

  const finePointer = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const plainSurface = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
  for (const panel of workspace.querySelectorAll('aside')) {
    panel.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !finePointer.matches || plainSurface.matches) return;
      const box = panel.getBoundingClientRect();
      panel.style.setProperty('--glass-pointer', `${Math.round(event.clientX - box.left)}px ${Math.round(event.clientY - box.top)}px`);
    }, { passive: true });
    panel.addEventListener('pointerleave', () => panel.style.removeProperty('--glass-pointer'));
  }
}
