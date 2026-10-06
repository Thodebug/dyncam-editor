import { ConfigStore } from './config-store.js';
import { SettingsPanel } from './settings-panel.js';
import { CommandsPanel } from './commands-panel.js';
import { setupTooltips } from './tooltip.js';
import { CollisionMap } from './collision.js';
import { Player } from './player.js';
import { TeeRenderer } from './tee-renderer.js';
import { GameView, SCREEN_FORMATS, TEE_POSITION } from './game-view.js';
import { PointerInput } from './pointer.js';
import { SnapshotButton } from './snapshot.js';
import { cameraOffsetAt } from './camera.js';
import { LoadingScreen, downloadImages } from './loading.js';

const MAP_IMAGES = {
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
const COLLISION_IMAGE = 'assets/map/collision.png';

const byId = (id) => document.getElementById(id);

/** Aspect ratio of the game view, from the chosen screen format. */
function viewAspect(store) {
  return (SCREEN_FORMATS.find((format) => format.id === store.screenFormat) ?? SCREEN_FORMATS[0]).aspect;
}

/** The game view takes the full height of the page; the settings column gets the remaining width. */
function fitPageLayout(aspect) {
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

  let viewWidth = contentHeight * aspect;
  if (contentWidth - gap - viewWidth < minimumSidebarWidth) {
    viewWidth = Math.max(200, contentWidth - gap - minimumSidebarWidth);
  }
  page.style.gridTemplateColumns = `${Math.floor(viewWidth)}px minmax(0, 1fr)`;
}

/** Sets the text of an element, only when it changes. */
function setText(element, text) {
  const value = String(text);
  if (element.textContent !== value) element.textContent = value;
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

/** The screen format tab: a list of formats under the tab, the chosen one is kept in the store. */
function setupScreenMenu(store) {
  const button = byId('screen-button');
  const menu = byId('screen-menu');
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  for (const format of SCREEN_FORMATS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.dataset.format = format.id;
    option.textContent = format.label;
    option.addEventListener('click', () => {
      store.setScreenFormat(format.id);
      close();
    });
    menu.appendChild(option);
  }

  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.screen-group')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return () => {
    const format = SCREEN_FORMATS.find((item) => item.id === store.screenFormat) ?? SCREEN_FORMATS[0];
    byId('screen-label').textContent = format.label;
    for (const option of menu.children) option.setAttribute('aria-selected', String(option.dataset.format === format.id));
  };
}

async function start() {
  setupTooltips(byId('tooltip'));

  const store = new ConfigStore();
  let gameView = null;
  const fitLayout = () => fitPageLayout(viewAspect(store));
  addEventListener('resize', fitLayout);
  const updateScreenMenu = setupScreenMenu(store);

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
  const stage = byId('stage');
  let shownAspect = null;
  store.onChange(() => {
    settingsPanel.update();
    commandsPanel.update();
    setSwitch(dyncamToggle, store.dyncam);
    updateScreenMenu();

    const aspect = viewAspect(store);
    if (aspect !== shownAspect) {
      shownAspect = aspect;
      stage.style.setProperty('--aspect', String(aspect));
      fitLayout();
      gameView?.setAspect(aspect);
    }
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
  const loadingScreen = new LoadingScreen(byId('loading'));
  let images;
  try {
    [images] = await Promise.all([
      downloadImages({ ...MAP_IMAGES, ...SPRITE_IMAGES, collision: COLLISION_IMAGE }, (progress) =>
        loadingScreen.showDownload(progress),
      ),
      document.fonts.load('12px "DejaVu Sans"').catch(() => {}),
    ]);
  } catch (error) {
    loadingScreen.showError();
    throw error;
  }
  const imagesOf = (urls) => Object.fromEntries(Object.keys(urls).map((key) => [key, images[key]]));

  const canvas = byId('game-canvas');
  const player = new Player(CollisionMap.fromImage(images.collision), TEE_POSITION);
  const pointer = new PointerInput({
    canvas,
    stage,
    store,
    player,
    getScreen: () => gameView.screen,
    onChange: () => gameView.requestRender(),
  });
  const view = new GameView({
    canvas,
    images: imagesOf(MAP_IMAGES),
    renderer: new TeeRenderer(imagesOf(SPRITE_IMAGES)),
    store,
    pointer,
    player,
  });
  view.setAspect(viewAspect(store));
  loadingScreen.showPreparing(0, view.scaleStepCount);
  await view.scaleLayersInSteps((done, total) => loadingScreen.showPreparing(done, total));
  gameView = view;
  if (view.aspect !== viewAspect(store)) view.setAspect(viewAspect(store));
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
    setText(byId('readout-cursor'), Math.round(cursor.distance));
    setText(byId('readout-cursor-max'), Math.round(limits.effectiveMax));
    setText(byId('readout-offset'), Math.round(Math.hypot(offset.x, offset.y)));
    setText(byId('readout-offset-max'), Math.round(cameraOffsetAt(limits.effectiveMax, limits)));
    setText(byId('readout-screen'), signed(Math.round(Math.hypot(onScreenX, onScreenY) * towardCursor)));
  };

  new ResizeObserver(() => gameView.resize()).observe(stage);
  settingsPanel.fitNames();
  gameView.resize();
  gameView.render();
  loadingScreen.hide();
}

start();
