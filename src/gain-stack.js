import './gain-stack.css';

export function setupGainStack(stack) {
  if (!('IntersectionObserver' in window) || !('ResizeObserver' in window)) return;
  const links = [...stack.querySelectorAll('.gain-stack-nav a')];
  const anchors = [...stack.querySelectorAll('.gain-anchor')];
  const cards = [...stack.querySelectorAll('.lesson-gain')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.min(1, Math.max(0, value));
  let stickyTops = [];
  let readLine = 0;
  let nearby = false;
  let queued = false;
  let selected = -1;

  function render() {
    queued = false;
    if (!nearby) return;
    const positions = anchors.map(anchor => anchor.getBoundingClientRect().top);
    const current = Math.max(0, positions.findLastIndex(top => top <= readLine + 8));
    if (current !== selected) {
      links[selected]?.removeAttribute('aria-current');
      links[current].setAttribute('aria-current', 'location');
      selected = current;
    }
    for (const [index, top] of stickyTops.entries()) {
      const height = cards[index].offsetHeight;
      const bottom = Math.max(top, positions[index]) + height;
      const depth = positions.slice(index + 1).reduce((sum, position) => sum + clamp((bottom - position) / height), 0);
      cards[index].style.setProperty('--gain-depth', depth.toFixed(3));
    }
  }

  function schedule() {
    if (nearby && !queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  }

  function measure() {
    readLine = parseFloat(getComputedStyle(anchors[0]).scrollMarginBlockStart);
    const room = document.documentElement.clientHeight - readLine - 16;
    const canStack = !reducedMotion.matches && cards.every(card => card.offsetHeight <= room);
    stack.toggleAttribute('data-stacked', canStack);
    stickyTops = canStack ? cards.map(card => parseFloat(getComputedStyle(card).top)) : [];
    schedule();
  }

  // The scroll effect only reads layout while the lesson is near the viewport.
  new IntersectionObserver(([entry]) => {
    nearby = entry.isIntersecting;
    schedule();
  }, { rootMargin: '200px 0px' }).observe(stack);
  const size = new ResizeObserver(measure);
  cards.forEach(card => size.observe(card));
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  reducedMotion.addEventListener('change', measure);
  measure();
}
