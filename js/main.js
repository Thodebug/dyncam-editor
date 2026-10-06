import { ConfigStore } from './config-store.js';
import { SettingsPanel } from './settings-panel.js';
import { CommandsPanel } from './commands-panel.js';
import { setupTooltips } from './tooltip.js';
import { CollisionMap } from './collision.js';
import { LaserGun } from './laser.js';
import { TeeRenderer } from './tee-renderer.js';
import { GameView, TEE_POSITION } from './game-view.js';
import { PointerInput } from './pointer.js';
import { SnapshotButton } from './snapshot.js';
import { cameraOffsetAt } from './camera.js';

const MAP_IMAGES = {
  sky: 'assets/map/sky.webp',
  'clouds-far': 'assets/map/clouds-far.webp',
  'clouds-near': 'assets/map/clouds-near.webp',
  cave: 'assets/map/cave.webp',
  background: 'assets/map/background.webp',
  foreground: 'assets/map/foreground.webp',
};
const SPRITE_IMAGES = {
  skin: 'assets/sprites/skin-default.png',
  game: 'assets/sprites/game.png',
  particles: 'assets/sprites/particles.png',
};

const byId = (id) => document.getElementById(id);

function loadImage(url) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

/** Loads { key: url } into { key: image }. */
async function loadImages(urls) {
  const entries = await Promise.all(Object.entries(urls).map(async ([key, url]) => [key, await loadImage(url)]));
  return Object.fromEntries(entries);
}

/** The game view takes the full height of the page; the settings column gets the remaining width. */
function fitPageLayout() {
  const page = document.querySelector('.page');
  if (!matchMedia('(min-width: 1001px)').matches) {
    page.style.gridTemplateColumns = '';
    return;
  }
  const style = getComputedStyle(page);
  const unit = Math.min(1.8, Math.max(1.3, innerHeight / 600));
  const contentWidth = page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const contentHeight = page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const gap = parseFloat(style.columnGap) || 0;
  const minimumSidebarWidth = 240 * unit;

  let viewWidth = (contentHeight * 16) / 9;
  if (contentWidth - gap - viewWidth < minimumSidebarWidth) {
    viewWidth = Math.max(200, contentWidth - gap - minimumSidebarWidth);
  }
  page.style.gridTemplateColumns = `${Math.floor(viewWidth)}px minmax(0, 1fr)`;
}

/** Shows a switch button as checked or not. */
function setSwitch(button, checked) {
  button.setAttribute('aria-checked', String(checked));
}

/** Text of a signed number: +12, −12 or 0. */
function signed(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${-value}`;
  return '0';
}

async function start() {
  setupTooltips(byId('tooltip'));
  fitPageLayout();
  addEventListener('resize', fitPageLayout);

  const store = new ConfigStore();
  let gameView = null;

  const settingsPanel = new SettingsPanel({
    store,
    onFocus: (name) => {
      if (!gameView) return;
      gameView.focusedSetting = name;
      gameView.requestRender();
    },
  });
  const commandsPanel = new CommandsPanel({ store });

  const dyncamToggle = byId('dyncam-toggle');
  store.onChange(() => {
    settingsPanel.update();
    commandsPanel.update();
    setSwitch(dyncamToggle, store.dyncam);
    gameView?.requestRender();
  });
  dyncamToggle.addEventListener('click', () => store.setDyncam(!store.dyncam));

  // A share link in the address wins over the last config saved in the browser.
  const loadLinkedConfig = () => store.loadShareToken(location.hash.replace(/^#/, ''));
  if (!loadLinkedConfig()) store.restore();
  addEventListener('hashchange', loadLinkedConfig);
  addEventListener('pagehide', () => store.save());
  store.notify();

  new ResizeObserver(() => settingsPanel.fitNames()).observe(byId('sidebar'));

  // Game view
  const [map, sprites, collision] = await Promise.all([
    loadImages(MAP_IMAGES),
    loadImages(SPRITE_IMAGES),
    CollisionMap.load('assets/map/collision.png'),
    document.fonts.load('12px "DejaVu Sans"').catch(() => {}),
  ]);

  const canvas = byId('game-canvas');
  const stage = byId('stage');
  const laserGun = new LaserGun(collision, TEE_POSITION);
  const pointer = new PointerInput({ canvas, stage, store, laserGun, onChange: () => gameView.requestRender() });
  gameView = new GameView({ canvas, images: map, renderer: new TeeRenderer(sprites), store, pointer, laserGun });
  new SnapshotButton({ gameView, store });

  const captureToggle = byId('capture-toggle');
  captureToggle.addEventListener('click', () => {
    pointer.setCaptureEnabled(!pointer.captureEnabled);
    setSwitch(captureToggle, pointer.captureEnabled);
  });

  const distancesToggle = byId('distances-toggle');
  const readout = byId('readout');
  distancesToggle.addEventListener('click', () => {
    gameView.showDistances = !gameView.showDistances;
    setSwitch(distancesToggle, gameView.showDistances);
    readout.hidden = !gameView.showDistances;
    byId('sidebar').classList.toggle('hide-colors', !gameView.showDistances);
    gameView.requestRender();
  });

  gameView.onFrame = ({ cursor, limits, offset }) => {
    if (readout.hidden) return;
    const onScreenX = cursor.position.x - offset.x;
    const onScreenY = cursor.position.y - offset.y;
    const towardCursor = Math.sign(onScreenX * cursor.direction.x + onScreenY * cursor.direction.y || 1);
    byId('readout-cursor').textContent = Math.round(cursor.distance);
    byId('readout-cursor-max').textContent = Math.round(limits.effectiveMax);
    byId('readout-offset').textContent = Math.round(Math.hypot(offset.x, offset.y));
    byId('readout-offset-max').textContent = Math.round(cameraOffsetAt(limits.effectiveMax, limits));
    byId('readout-screen').textContent = signed(Math.round(Math.hypot(onScreenX, onScreenY) * towardCursor));
  };

  new ResizeObserver(() => gameView.resize()).observe(stage);
  settingsPanel.fitNames();
  gameView.resize();
  gameView.requestRender();
}

start();
