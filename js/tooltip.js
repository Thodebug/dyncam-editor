const SHOW_DELAY_MS = 350;
/** Info buttons exist to be read: their tooltip comes sooner. */
const INFO_SHOW_DELAY_MS = 150;
const MARGIN = 9;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** HTML of a tooltip text: **bold**, line breaks kept by the tooltip's CSS. */
export function tipMarkup(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/** A value in the color of a setting's circle. */
export function coloredValue(value, colorVariable) {
  return `<span class="tip-value" style="color: var(${colorVariable})">${escapeHtml(value)}</span>`;
}

/** A fraction with the numerator over the denominator. Both are HTML. */
export function fraction(numerator, denominator) {
  return `<span class="tip-fraction"><span>${numerator}</span><span>${denominator}</span></span>`;
}

/**
 * Tooltips in the DDNet style for every element with a data-tip attribute (text with **bold** and line breaks),
 * or with a tipContent() function returning HTML, for tooltips with live values.
 * Shown above the element (below if there is no room), centered on the pointer, kept inside the window.
 */
export function setupTooltips(tooltip) {
  let showTimer = 0;

  const hide = () => tooltip.classList.remove('is-visible');

  const show = (element, pointerX) => {
    tooltip.innerHTML = element.tipContent ? element.tipContent() : tipMarkup(element.dataset.tip);
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

  const tipElement = (target) => target.closest?.('[data-tip], .has-tip');

  document.addEventListener('pointerover', (event) => {
    const element = tipElement(event.target);
    clearTimeout(showTimer);
    if (!element) {
      hide();
      return;
    }
    const delay = element.classList.contains('info-button') ? INFO_SHOW_DELAY_MS : SHOW_DELAY_MS;
    showTimer = setTimeout(() => show(element, event.clientX), delay);
  });

  document.addEventListener('pointerdown', () => {
    clearTimeout(showTimer);
    hide();
  });

  // Keyboard focus shows the tooltip; a mouse click does not.
  document.addEventListener('focusin', (event) => {
    const element = tipElement(event.target);
    if (element && event.target.matches(':focus-visible')) show(element);
    else hide();
  });
}
