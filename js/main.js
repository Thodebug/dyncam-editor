import { ConfigStore } from './config-store.js';
import { SettingsPanel } from './settings-panel.js';
import { CommandsPanel } from './commands-panel.js';
import { setupTooltips } from './tooltip.js';
import { CollisionMap } from './collision.js';
import { Player } from './player.js';
import { TeeRenderer } from './tee-renderer.js';
import { GameView, SCREEN_FORMATS } from './game-view.js';
import { PointerInput } from './pointer.js';
import { SnapshotButton } from './snapshot.js';
import { cameraOffsetAt } from './camera.js';
import { LoadingScreen, downloadFiles, imageFromBlob } from './loading.js';
import { Graphics, WebGLUnavailableError } from './graphics.js';
import { readMap } from './map-file.js';
import { MapRenderer } from './map-renderer.js';
import { MAPS, MAPS_BY_ID } from './maps.js';

const SPRITE_IMAGES = {
  skin: 'assets/sprites/skin-default.png',
  game: 'assets/sprites/game.png',
  particles: 'assets/sprites/particles.png',
};
/** data/editor/entities_clear/ddnet.png with the tiles DDNet hides on DDNet servers already removed */
const ENTITIES_IMAGE = 'assets/entities/ddnet.png';

/** Gives the browser a frame to show the loading screen. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

const byId = (id) => document.getElementById(id);

/** Aspect ratio of the game view, from the chosen screen format. */
function viewAspect(store) {
  return (SCREEN_FORMATS.find((format) => format.id === store.screenFormat) ?? SCREEN_FORMATS[0]).aspect;
}

/** The game view takes the full height of the page; the settings column gets the remaining width. */
function fitPageLayout(aspect) {
  const page = document.querySelector('.page');
  if (!matchMedia('(min-width: 1221px)').matches) {
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

/**
 * A tab with a list under it (screen format, map): `options` is [{ id, label }],
 * chosen() gives the chosen id and choose(id) changes it. Returns the function that shows the chosen option.
 */
function setupTabMenu({ group, options, chosen, choose }) {
  const button = group.querySelector('.tab-menu');
  const label = group.querySelector('.tab-menu-label');
  const menu = group.querySelector('.menu');
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  for (const { id, label: text } of options) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.dataset.id = id;
    option.textContent = text;
    option.addEventListener('click', () => {
      choose(id);
      close();
    });
    menu.appendChild(option);
  }

  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!group.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return () => {
    const id = chosen();
    label.textContent = options.find((option) => option.id === id)?.label ?? id;
    for (const option of menu.children) option.setAttribute('aria-selected', String(option.dataset.id === id));
  };
}

/** The game layer of a map, for the collision. */
function gameLayerOf(map) {
  const gameLayer = map.groups.flatMap((group) => group.layers).find((layer) => layer.type === 'tiles' && layer.game);
  if (!gameLayer) throw new Error('The map has no game layer');
  return gameLayer;
}

async function start() {
  setupTooltips(byId('tooltip'));

  const store = new ConfigStore();
  let gameView = null;
  const fitLayout = () => fitPageLayout(viewAspect(store));
  addEventListener('resize', fitLayout);
  const updateScreenMenu = setupTabMenu({
    group: byId('screen-group'),
    options: SCREEN_FORMATS,
    chosen: () => (SCREEN_FORMATS.find((format) => format.id === store.screenFormat) ?? SCREEN_FORMATS[0]).id,
    choose: (id) => store.setScreenFormat(id),
  });
  const updateMapMenu = setupTabMenu({
    group: byId('map-group'),
    options: MAPS.map((map) => ({ id: map.id, label: map.id })),
    chosen: () => store.mapId,
    choose: (id) => store.setMap(id),
  });

  const settingsPanel = new SettingsPanel({
    store,
    onFocus: (name) => {
      if (!gameView) return;
      gameView.focusedSetting = name;
      gameView.requestRender();
    },
  });
  const commandsPanel = new CommandsPanel({ store, onLoaded: (names) => settingsPanel.highlight(names) });

  const dyncamToggle = byId('dyncam-toggle');
  const entitiesToggle = byId('entities-toggle');
  const stage = byId('stage');
  let shownAspect = null;
  // Set once the game view is ready: shows the store's map, downloading it if needed.
  let showStoreMap = null;
  store.onChange(() => {
    settingsPanel.update();
    commandsPanel.update();
    setSwitch(dyncamToggle, store.dyncam);
    setSwitch(entitiesToggle, store.entities);
    updateScreenMenu();
    updateMapMenu();
    showStoreMap?.();

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
  entitiesToggle.addEventListener('click', () => store.setEntities(!store.entities));

  // The last state saved in the browser keeps the user's baseline; a share link replaces the values,
  // the map and the entities view. Once applied, the link is removed from the address,
  // so a reload keeps the changes made since. A link that cannot be read stays in the address.
  const loadLinkedConfig = () => {
    const fragment = location.hash.replace(/^#/, '');
    if (!fragment) return;
    const error = store.loadShareFragment(fragment);
    commandsPanel.showLinkError(error);
    if (!error) history.replaceState(null, '', location.pathname + location.search);
  };
  store.restore();
  loadLinkedConfig();
  addEventListener('hashchange', loadLinkedConfig);
  addEventListener('pagehide', () => store.save());
  store.notify();

  new ResizeObserver(() => settingsPanel.fitNames()).observe(byId('sidebar'));

  // Game view
  const loadingScreen = new LoadingScreen(byId('loading'));
  const canvas = byId('game-canvas');
  const files = new Map(); // url → Blob: each file is downloaded once
  let graphics = null;
  let teeRenderer = null;
  let entitiesImage = null;
  let pointer = null;

  /** Downloads the files not downloaded yet, with the loading screen. urls: { key: url }. Returns { key: Blob }. */
  const download = async (urls, mapName) => {
    const missing = Object.fromEntries(Object.entries(urls).filter(([, url]) => !files.has(url)));
    if (Object.keys(missing).length) {
      loadingScreen.start(mapName);
      const blobs = await downloadFiles(missing, (progress) => loadingScreen.showDownload(progress));
      for (const [key, url] of Object.entries(missing)) files.set(url, blobs[key]);
    }
    return Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, files.get(url)]));
  };

  /** Downloads and prepares a map, then shows it. The first map also prepares WebGL and the tee's images. */
  const loadMap = async (id) => {
    const info = MAPS_BY_ID[id];
    const imageUrls = Object.fromEntries(info.images.map((name) => [name, `assets/mapres/${name}.png`]));
    const firstMap = !graphics;
    const steps = firstMap ? 3 : 2;
    const [downloaded] = await Promise.all([
      download(
        {
          map: `assets/map/${id}.map`,
          ...imageUrls,
          ...(firstMap ? { ...SPRITE_IMAGES, entities: ENTITIES_IMAGE } : {}),
        },
        id,
      ),
      firstMap ? document.fonts.load('12px "DejaVu Sans"').catch(() => {}) : null,
    ]);
    loadingScreen.showPreparing(0, steps);
    const decode = async (keys) =>
      Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await imageFromBlob(downloaded[key])])));
    const [map, mapImages, spriteImages] = await Promise.all([
      downloaded.map.arrayBuffer().then(readMap),
      decode(info.images),
      firstMap ? decode([...Object.keys(SPRITE_IMAGES), 'entities']) : null,
    ]);
    loadingScreen.showPreparing(1, steps);
    await nextFrame();
    if (firstMap) {
      graphics = new Graphics(canvas);
      entitiesImage = spriteImages.entities;
      teeRenderer = new TeeRenderer(graphics, spriteImages);
      loadingScreen.showPreparing(2, steps);
      await nextFrame();
    }
    const mapRenderer = new MapRenderer(graphics, map, mapImages, entitiesImage);
    const player = new Player(CollisionMap.fromGameLayer(gameLayerOf(map)), info.tee);
    loadingScreen.showPreparing(steps, steps);

    if (gameView) {
      gameView.map.dispose();
      pointer.player = player;
      gameView.setMap({ map: mapRenderer, player, tee: info.tee });
      return;
    }
    pointer = new PointerInput({
      canvas,
      stage,
      store,
      player,
      getScreen: () => gameView.screen,
      onChange: () => gameView.requestRender(),
    });
    gameView = new GameView({
      canvas,
      graphics,
      map: mapRenderer,
      renderer: teeRenderer,
      store,
      pointer,
      player,
      tee: info.tee,
    });
  };

  const showLoadError = (error) => {
    if (error instanceof WebGLUnavailableError) {
      loadingScreen.showError(
        'WebGL 2 is not available in this browser.',
        'Turn on hardware acceleration or try another browser.',
      );
    } else {
      loadingScreen.showError();
    }
  };

  // Loads maps one at a time, until the map shown is the store's map.
  let shownMapId = null;
  let loading = false;
  const loadStoreMap = async () => {
    if (loading) return;
    loading = true;
    try {
      while (store.mapId !== shownMapId) {
        const id = store.mapId;
        await loadMap(id);
        shownMapId = id;
      }
      // The first map's loading screen stays until the view is drawn.
      if (showStoreMap) loadingScreen.hide();
    } finally {
      loading = false;
    }
  };

  try {
    await loadStoreMap();
  } catch (error) {
    showLoadError(error);
    throw error;
  }
  showStoreMap = () => {
    if (store.mapId === shownMapId) return;
    loadStoreMap().catch((error) => {
      showLoadError(error);
      console.error(error);
    });
  };

  gameView.setAspect(viewAspect(store));
  new SnapshotButton({ gameView, store });

  const captureToggle = byId('capture-toggle');
  captureToggle.addEventListener('click', () => {
    pointer.setCaptureEnabled(!pointer.captureEnabled);
    setSwitch(captureToggle, pointer.captureEnabled);
  });

  const distancesToggle = byId('distances-toggle');
  const readout = byId('readout');
  const showDistances = (shown) => {
    gameView.showDistances = shown;
    setSwitch(distancesToggle, shown);
    readout.hidden = !shown;
    byId('sidebar').classList.toggle('hide-colors', !shown);
    gameView.requestRender();
  };
  distancesToggle.addEventListener('click', () => showDistances(!gameView.showDistances));
  showDistances(true);

  gameView.onFrame = ({ cursor, limits, offset, cursorOnScreen }) => {
    if (readout.hidden) return;
    const towardCursor = Math.sign(cursorOnScreen.x * cursor.direction.x + cursorOnScreen.y * cursor.direction.y || 1);
    setText(byId('readout-cursor'), Math.round(cursor.distance));
    setText(byId('readout-cursor-max'), Math.round(limits.effectiveMax));
    setText(byId('readout-offset'), Math.round(Math.hypot(offset.x, offset.y)));
    setText(byId('readout-offset-max'), Math.round(cameraOffsetAt(limits.effectiveMax, limits)));
    setText(byId('readout-screen'), signed(Math.round(Math.hypot(cursorOnScreen.x, cursorOnScreen.y) * towardCursor)));
  };

  new ResizeObserver(() => gameView.resize()).observe(stage);
  settingsPanel.fitNames();
  gameView.resize();
  gameView.render();
  loadingScreen.hide();
}

start();
