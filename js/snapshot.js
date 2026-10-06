const VIEW_WIDTH = 1600;
const PADDING = 28;
const FONT_SIZE = 22;
const LINE_HEIGHT = FONT_SIZE * 1.5;
const CAMERA_ICON = '';
const CHECK_ICON = '';

/**
 * Builds a PNG of the game view with the command list on its right, in the style of the DDNet menus.
 * lines: [{ name, value, changed }]
 */
export function renderSnapshot(viewCanvas, lines, font, backgroundColor) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${FONT_SIZE}px ${font}`;
  const textWidth = Math.max(
    measure.measureText('No changes').width,
    ...lines.map((line) => measure.measureText(`${line.name} ${line.value}`).width),
  );
  const panelWidth = Math.ceil(textWidth + PADDING * 2 + 24);
  const viewHeight = Math.round((VIEW_WIDTH * viewCanvas.height) / viewCanvas.width);
  const listHeight = Math.max(lines.length, 1) * LINE_HEIGHT + 20;
  const height = Math.max(viewHeight, PADDING + 56 + listHeight + PADDING);

  const canvas = document.createElement('canvas');
  canvas.width = VIEW_WIDTH + panelWidth;
  canvas.height = height;
  const context = canvas.getContext('2d');

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(viewCanvas, 0, Math.round((height - viewHeight) / 2), VIEW_WIDTH, viewHeight);
  context.fillStyle = 'rgba(0, 0, 0, 0.5)';
  context.fillRect(VIEW_WIDTH, 0, panelWidth, height);

  const drawText = (text, x, y, size, opacity) => {
    context.font = `${size}px ${font}`;
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    context.strokeText(text, x, y);
    context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    context.fillText(text, x, y);
  };

  const left = VIEW_WIDTH + PADDING;
  const listTop = PADDING + 66;
  context.textBaseline = 'top';
  drawText('Dyncam editor', left, PADDING, 30, 1);

  context.fillStyle = 'rgba(0, 0, 0, 0.15)';
  context.beginPath();
  context.roundRect(left - 12, PADDING + 56, panelWidth - PADDING * 2 + 24, listHeight, 8);
  context.fill();

  if (!lines.length) drawText('No changes', left, listTop, FONT_SIZE, 0.5);
  lines.forEach((line, index) => {
    drawText(`${line.name} ${line.value}`, left, listTop + index * LINE_HEIGHT, FONT_SIZE, line.changed ? 1 : 0.5);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * The camera button over the game view: copies the snapshot to the clipboard,
 * or shows it in a popup when the browser does not allow copying images.
 */
export class SnapshotButton {
  constructor({ gameView, store }) {
    this.gameView = gameView;
    this.store = store;
    this.button = document.getElementById('snapshot-button');
    this.icon = document.getElementById('snapshot-icon');
    this.popup = document.getElementById('snapshot-popup');
    this.image = document.getElementById('snapshot-image');

    this.button.addEventListener('click', () => this.copySnapshot());
    document.getElementById('snapshot-close').addEventListener('click', () => this.closePopup());
    this.popup.addEventListener('pointerdown', (event) => {
      if (event.target === this.popup) this.closePopup();
    });
  }

  async copySnapshot() {
    // A fresh frame without the help text
    this.gameView.render({ hideHint: true });
    this.gameView.requestRender();

    const style = getComputedStyle(document.documentElement);
    const blob = await renderSnapshot(
      this.gameView.canvas,
      this.store.commandLines(),
      this.gameView.font,
      style.getPropertyValue('--ui-color').trim(),
    );

    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      this.openPopup(blob);
      return;
    }
    this.icon.textContent = CHECK_ICON;
    this.button.classList.add('is-done');
    setTimeout(() => {
      this.icon.textContent = CAMERA_ICON;
      this.button.classList.remove('is-done');
    }, 1600);
  }

  openPopup(blob) {
    this.image.src = URL.createObjectURL(blob);
    this.popup.hidden = false;
    document.getElementById('snapshot-close').focus();
  }

  closePopup() {
    this.popup.hidden = true;
    URL.revokeObjectURL(this.image.src);
  }
}
