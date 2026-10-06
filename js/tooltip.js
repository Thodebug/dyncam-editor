const SHOW_DELAY_MS = 350;
const MARGIN = 9;

/**
 * Tooltips in the DDNet style for every element with a data-tip attribute:
 * shown above the element (below if there is no room), centered on the pointer, kept inside the window.
 */
export function setupTooltips(tooltip) {
  let showTimer = 0;

  const hide = () => tooltip.classList.remove('is-visible');

  const show = (element, pointerX) => {
    tooltip.textContent = element.dataset.tip;
    tooltip.classList.add('is-visible');
    const box = element.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const centerX = pointerX ?? box.left + box.width / 2;
    const left = Math.min(Math.max(centerX - width / 2, MARGIN), innerWidth - width - MARGIN);
    let top = box.top - height - MARGIN;
    if (top < MARGIN) top = box.bottom + MARGIN;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  document.addEventListener('pointerover', (event) => {
    const element = event.target.closest?.('[data-tip]');
    clearTimeout(showTimer);
    if (!element) {
      hide();
      return;
    }
    showTimer = setTimeout(() => show(element, event.clientX), SHOW_DELAY_MS);
  });

  document.addEventListener('pointerdown', () => {
    clearTimeout(showTimer);
    hide();
  });

  // Keyboard focus shows the tooltip; a mouse click does not.
  document.addEventListener('focusin', (event) => {
    const element = event.target.closest?.('[data-tip]');
    if (element && event.target.matches(':focus-visible')) show(element);
    else hide();
  });
}
