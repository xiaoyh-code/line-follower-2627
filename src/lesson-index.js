export function setupLessonIndex(layout) {
  const dock = layout.querySelector('.study-dock');
  const toggle = dock.querySelector('.study-index-toggle');
  const nav = dock.querySelector('nav');
  let openMode = null;

  function setOpen(mode) {
    openMode = mode;
    nav.hidden = !mode;
    toggle.setAttribute('aria-expanded', String(Boolean(mode)));
  }

  dock.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && !openMode) setOpen('hover');
  });
  dock.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' && !nav.contains(document.activeElement)) setOpen(null);
  });
  toggle.addEventListener('click', () => setOpen(openMode === 'button' ? null : 'button'));
  dock.addEventListener('focusout', event => {
    if (!dock.contains(event.relatedTarget)) setOpen(null);
  });
  document.addEventListener('pointerdown', event => {
    if (openMode && !dock.contains(event.target)) setOpen(null);
  });
  document.addEventListener('keydown', event => {
    if (openMode && event.key === 'Escape') {
      if (nav.contains(document.activeElement)) toggle.focus();
      setOpen(null);
    }
  });
  nav.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    document.getElementById(link.hash.slice(1))?.focus({ preventScroll: true });
    setOpen(null);
  });

  if (!('IntersectionObserver' in window)) {
    dock.toggleAttribute('data-available', true);
    return;
  }
  new IntersectionObserver(([entry]) => {
    dock.toggleAttribute('data-available', entry.isIntersecting);
    if (!entry.isIntersecting) setOpen(null);
  }).observe(layout);
}
