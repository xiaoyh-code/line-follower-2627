// Apply the saved palette before the first paint, including on a link straight to a lesson.
(() => {
  const key = 'line-follower-lab.theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const normalize = value => value === 'light' || value === 'dark' ? value : 'system';
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Storage is optional. */ }

  function apply() {
    const picker = document.getElementById('theme-picker');
    if (picker) picker.value = preference;
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    document.dispatchEvent(new Event('themechange'));
  }

  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = normalize(event.newValue);
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('theme-picker');
    picker.value = preference;
    picker.addEventListener('change', () => {
      preference = normalize(picker.value);
      try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
      apply();
    });
  });
})();
