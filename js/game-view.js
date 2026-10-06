import { CAMERA_MAX_DISTANCE, CameraSmoothing, cameraOffsetAt, cursorFromMouse, cursorLimits } from './camera.js';
import { gameTick } from './player.js';

/**
 * Visible world size at zoom 1 for a screen aspect ratio (width / height),
 * from IGraphics::CalcScreenParams().
 */
export function screenSize(aspect) {
  const amount = 1150 * 1000;
  const maxWidth = 1500;
  const maxHeight = 1050;
  let height = Math.sqrt(amount) / Math.sqrt(aspect);
  let width = height * aspect;
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspect;
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * Screen formats the map images fully cover. Other formats need taller captures.
 * The aspect ratio is the window width / height in pixels, as in IGraphics::ScreenAspect().
 */
export const SCREEN_FORMATS = [
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: '21:9', label: '21:9 (2560×1080)', aspect: 2560 / 1080 },
  { id: '21:9-wide', label: '21:9 (3440×1440)', aspect: 3440 / 1440 },
];

/** The tee stands on the ctf5 platform at tile (162, 55). */
export const TEE_POSITION = { x: 5200, y: 1777 };

/**
 * The map layers are screenshots of the game on a 16:9 screen, taken with the camera at CAPTURE_CAMERA
 * and a zoom of CAPTURE_ZOOM, one image per group of layers. Each image is drawn with the parallax of its group.
 */
const CAPTURE_SCREEN = screenSize(16 / 9);
const CAPTURE_CAMERA = { x: 5200, y: 1776 };
const CAPTURE_ZOOM = Math.pow(0.866025, -3);
const LAYERS_BEHIND = [
  { name: 'clouds-far', parallaxX: 49, parallaxY: 51 },
  { name: 'clouds-near', parallaxX: 70, parallaxY: 70 },
  { name: 'cave', parallaxX: 96, parallaxY: 96 },
  { name: 'background', parallaxX: 100, parallaxY: 100 },
];
const LAYERS_IN_FRONT = [{ name: 'foreground', parallaxX: 100, parallaxY: 100 }];

/**
 * Sky of ctf5: one quad with a color per corner, in a group with a parallax of 0.
 * The GPU draws it as the triangles (0, 1, 3) and (0, 3, 2) with linearly interpolated colors.
 */
const SKY_CORNERS = [
  { x: -1045.52734375, y: -773.134765625, color: [106, 106, 106] },
  { x: 1069.373046875, y: -773.134765625, color: [106, 106, 106] },
  { x: -1045.52734375, y: 943.1611328125, color: [59, 73, 130] },
  { x: 1069.373046875, y: 943.1611328125, color: [67, 69, 100] },
];
const SKY_TRIANGLES = [
  [0, 1, 3],
  [0, 3, 2],
];

/** Draws the sky quad for a view of `viewWidth` × `viewHeight` units centered on (0, 0). */
function renderSky(width, height, viewWidth, viewHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const pixels = image.data;

  for (let row = 0; row < height; row++) {
    const y = ((row + 0.5) / height) * viewHeight - viewHeight / 2;
    for (let column = 0; column < width; column++) {
      const x = ((column + 0.5) / width) * viewWidth - viewWidth / 2;
      for (const [i, j, k] of SKY_TRIANGLES) {
        const a = SKY_CORNERS[i];
        const b = SKY_CORNERS[j];
        const c = SKY_CORNERS[k];
        const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        const weightA = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / area;
        const weightB = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / area;
        const weightC = 1 - weightA - weightB;
        if (weightA < -1e-9 || weightB < -1e-9 || weightC < -1e-9) continue;
        const offset = (row * width + column) * 4;
        for (let channel = 0; channel < 3; channel++) {
          pixels[offset + channel] = Math.round(
            weightA * a.color[channel] + weightB * b.color[channel] + weightC * c.color[channel],
          );
        }
        pixels[offset + 3] = 255;
        break;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Bounding box of the non-transparent pixels of an image: { left, top, right, bottom }, right and bottom excluded. */
function opaqueBounds(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const alpha = context.getImageData(0, 0, image.width, image.height).data;
  const bounds = { left: image.width, top: image.height, right: 0, bottom: 0 };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alpha[(y * image.width + x) * 4 + 3] === 0) continue;
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x + 1);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y + 1);
    }
  }
  return bounds;
}

/** Canvas showing the game as DDNet renders it: map, tee, laser, hook, cursor and distance circles. */
export class GameView {
  /**
   * images: map layers by name, renderer: TeeRenderer, store: ConfigStore,
   * pointer: PointerInput, player: Player
   */
  constructor({ canvas, images, renderer, store, pointer, player }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.images = images;
    this.renderer = renderer;
    this.store = store;
    this.pointer = pointer;
    this.player = player;
    this.camera = new CameraSmoothing();

    this.showDistances = false;
    this.focusedSetting = null;
    this.onFrame = null;

    this.aspect = 16 / 9;
    this.screen = screenSize(this.aspect);
    this.pixelRatio = 1;
    this.scale = 1;
    this.scaledLayers = null;
    this.ringCache = null;
    this.frameRequest = 0;
    this.blinkTimer = 0;
    this.layerBounds = Object.fromEntries(
      [...LAYERS_BEHIND, ...LAYERS_IN_FRONT].map((layer) => [layer.name, opaqueBounds(images[layer.name])]),
    );

    const style = getComputedStyle(document.documentElement);
    this.font = style.getPropertyValue('--font').trim();
    this.colorOf = (variable) => style.getPropertyValue(variable).trim();
  }

  requestRender() {
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(() => this.render());
  }

  /** Screen aspect ratio of the simulated game window. */
  setAspect(aspect) {
    this.aspect = aspect;
    this.screen = screenSize(aspect);
    this.resize();
  }

  /** Matches the canvas resolution to its size on screen. */
  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width) return;
    this.pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * this.pixelRatio));
    const height = Math.max(1, Math.round((box.width / this.aspect) * this.pixelRatio));
    if (width === this.canvas.width && height === this.canvas.height && this.scaledLayers) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.scaledLayers = null;
    this.ringCache = null;
    this.requestRender();
  }

  /**
   * Prepares the sky and resamples each layer once for the current canvas size, so frames only copy pixels.
   * Each resampled layer keeps only the part that can appear on screen: its non-transparent pixels, within
   * the area the camera can reach (the camera offset never exceeds CAMERA_MAX_DISTANCE).
   */
  scaleLayers() {
    const { width, height } = this.canvas;
    const scaleX = width / this.screen.width;
    const scaleY = height / this.screen.height;
    const layers = { sky: { canvas: renderSky(width, height, this.screen.width, this.screen.height), left: 0, top: 0 } };

    for (const layer of [...LAYERS_BEHIND, ...LAYERS_IN_FRONT]) {
      const image = this.images[layer.name];
      // IGraphics::MapScreenToWorld(): a layer with parallax p shows (p × (zoom − 1) + 100) / 100 times the zoom 1 view.
      const parallax = Math.min(Math.max(layer.parallaxX, layer.parallaxY), 100);
      const factor = (parallax * (CAPTURE_ZOOM - 1) + 100) / 100;
      const fullWidth = Math.max(1, Math.round(CAPTURE_SCREEN.width * factor * scaleX));
      const fullHeight = Math.max(1, Math.round(CAPTURE_SCREEN.height * factor * scaleY));

      // Reachable area, in pixels of the resampled layer, with 2 pixels of margin for rounding
      const reachX = (CAMERA_MAX_DISTANCE + Math.abs(TEE_POSITION.x - CAPTURE_CAMERA.x)) * (layer.parallaxX / 100) * scaleX;
      const reachY = (CAMERA_MAX_DISTANCE + Math.abs(TEE_POSITION.y - CAPTURE_CAMERA.y)) * (layer.parallaxY / 100) * scaleY;
      // Non-transparent pixels, with 2 source pixels of margin for the resampling filter
      const bounds = this.layerBounds[layer.name];
      const ratioX = fullWidth / image.width;
      const ratioY = fullHeight / image.height;

      const left = Math.max(0, Math.floor(fullWidth / 2 - width / 2 - reachX - 2), Math.floor((bounds.left - 2) * ratioX));
      const right = Math.min(fullWidth, Math.ceil(fullWidth / 2 + width / 2 + reachX + 2), Math.ceil((bounds.right + 2) * ratioX));
      const top = Math.max(0, Math.floor(fullHeight / 2 - height / 2 - reachY - 2), Math.floor((bounds.top - 2) * ratioY));
      const bottom = Math.min(fullHeight, Math.ceil(fullHeight / 2 + height / 2 + reachY + 2), Math.ceil((bounds.bottom + 2) * ratioY));
      if (right <= left || bottom <= top) continue;

      const full = document.createElement('canvas');
      full.width = fullWidth;
      full.height = fullHeight;
      const fullContext = full.getContext('2d');
      fullContext.imageSmoothingEnabled = true;
      fullContext.imageSmoothingQuality = 'high';
      fullContext.drawImage(image, 0, 0, fullWidth, fullHeight);

      const kept = document.createElement('canvas');
      kept.width = right - left;
      kept.height = bottom - top;
      kept.getContext('2d').drawImage(full, -left, -top);
      layers[layer.name] = { canvas: kept, left, top, fullWidth, fullHeight };
    }
    this.scaledLayers = layers;
  }

  /** Draws a layer for a camera at `camera` units from CAPTURE_CAMERA. */
  drawLayer(layer, camera) {
    const scaled = this.scaledLayers[layer.name];
    if (!scaled) return;
    const { width, height } = this.canvas;
    const x = width / 2 - scaled.fullWidth / 2 - ((camera.x * layer.parallaxX) / 100) * (width / this.screen.width);
    const y = height / 2 - scaled.fullHeight / 2 - ((camera.y * layer.parallaxY) / 100) * (height / this.screen.height);
    this.context.drawImage(scaled.canvas, Math.round(x) + scaled.left, Math.round(y) + scaled.top);
  }

  render({ hideHint = false } = {}) {
    this.frameRequest = 0;
    const context = this.context;
    const { width, height } = this.canvas;
    if (!width || !height) return;

    const now = performance.now();
    const limits = cursorLimits(this.store.values, this.store.dyncam);
    const cursor = cursorFromMouse(this.pointer.mouse, limits);
    const targetOffset = { x: cursor.direction.x * cursor.cameraOffset, y: cursor.direction.y * cursor.cameraOffset };
    const cameraMoving = this.camera.update(cursor.position, targetOffset, {
      smoothness: this.store.values.cl_dyncam_smoothness,
      stabilizing: this.store.values.cl_dyncam_stabilizing,
      dyncam: this.store.dyncam,
    }, now);
    const offset = this.camera.offset;
    this.scale = width / this.screen.width;
    this.onFrame?.({ cursor, limits, offset });

    if (!this.scaledLayers) this.scaleLayers();

    // Map behind the tee
    const layerCamera = {
      x: offset.x + TEE_POSITION.x - CAPTURE_CAMERA.x,
      y: offset.y + TEE_POSITION.y - CAPTURE_CAMERA.y,
    };
    context.drawImage(this.scaledLayers.sky.canvas, 0, 0);
    for (const layer of LAYERS_BEHIND) this.drawLayer(layer, layerCamera);

    // Items, then the player, as in the game
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const view = {
      scale: this.scale,
      originX: width / 2 - (TEE_POSITION.x + offset.x) * this.scale,
      originY: height / 2 - (TEE_POSITION.y + offset.y) * this.scale,
    };
    const tick = gameTick(now);
    this.player.update(now, cursor.position);
    for (const segment of this.player.laser.visibleSegments(tick)) {
      this.renderer.drawLaser(context, view, segment.from, segment.to, segment.width, tick);
    }
    const hookPosition = this.player.hook.positionAt(tick);
    if (hookPosition) this.renderer.drawHook(context, view, TEE_POSITION, hookPosition);
    const pose = this.player.pose(now);
    this.renderer.drawPlayer(context, view, TEE_POSITION, cursor.direction, this.player.weapon, pose);

    // Map in front of the tee
    for (const layer of LAYERS_IN_FRONT) this.drawLayer(layer, layerCamera);

    // Distance circles around the tee, all of them or the one of the hovered setting
    const teeOnCanvas = { x: width / 2 - offset.x * this.scale, y: height / 2 - offset.y * this.scale };
    if (this.showDistances) this.drawRings(limits, teeOnCanvas, null);
    else if (this.focusedSetting) this.drawRings(limits, teeOnCanvas, this.focusedSetting);

    const cursorOffset = { x: cursor.position.x - offset.x, y: cursor.position.y - offset.y };
    this.renderer.drawCursor(context, { x: width / 2, y: height / 2 }, cursorOffset, this.scale, this.player.weapon);

    const hint = hideHint ? '' : this.pointer.hint();
    if (hint) this.drawHint(hint);

    if (cameraMoving || this.player.isAnimating(now)) {
      this.requestRender();
    } else {
      // Nothing moves: the next change is the tee's blink.
      clearTimeout(this.blinkTimer);
      this.blinkTimer = setTimeout(() => this.requestRender(), this.player.msUntilBlinkChange(now) + 1);
    }
  }

  drawHint(text) {
    const context = this.context;
    const { width, height } = this.canvas;
    const ratio = this.pixelRatio;
    context.save();
    context.font = `${14 * ratio}px ${this.font}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const boxWidth = context.measureText(text).width + 24 * ratio;
    context.fillStyle = 'rgba(51, 51, 51, 0.8)';
    context.beginPath();
    context.roundRect(width / 2 - boxWidth / 2, height * 0.82 - 14 * ratio, boxWidth, 28 * ratio, 8 * ratio);
    context.fill();
    context.fillStyle = '#fff';
    context.fillText(text, width / 2, height * 0.82);
    context.restore();
  }

  /* ---------- Distance circles ---------- */

  /** Circles to draw: [{ radius, color, label, faint, dotted, setting }] */
  rings(limits) {
    const dyncam = this.store.dyncam;
    const prefix = dyncam ? 'cl_dyncam_' : 'cl_mouse_';
    const maxColor = this.colorOf(dyncam ? '--ring-dyncam-max' : '--ring-mouse-max');
    const minColor = this.colorOf(dyncam ? '--ring-dyncam-min' : '--ring-mouse-min');
    const followFactorSetting = dyncam ? 'cl_dyncam_follow_factor' : 'cl_mouse_followfactor';
    const rings = [];

    if (limits.effectiveMax < limits.maxDistance) {
      rings.push({
        radius: limits.maxDistance,
        color: maxColor,
        label: `${prefix}max_distance ${limits.maxDistance} (no effect)`,
        faint: true,
        setting: prefix + 'max_distance',
      });
      rings.push({
        radius: limits.effectiveMax,
        color: maxColor,
        label: `max cursor distance ${Math.round(limits.effectiveMax)}`,
        setting: prefix + 'max_distance',
      });
    } else {
      rings.push({
        radius: limits.maxDistance,
        color: maxColor,
        label: `${prefix}max_distance ${limits.maxDistance}`,
        setting: prefix + 'max_distance',
      });
    }

    if (limits.minDistance > 0) {
      const effectiveMin = Math.min(limits.minDistance, limits.effectiveMax);
      const note = effectiveMin < limits.minDistance ? ` (effective ${Math.round(effectiveMin)})` : '';
      rings.push({
        radius: effectiveMin,
        color: minColor,
        label: `${prefix}min_distance ${limits.minDistance}${note}`,
        setting: prefix + 'min_distance',
      });
    }

    if (limits.followFactor > 0 && limits.deadzone > 0) {
      rings.push({
        radius: limits.deadzone,
        color: this.colorOf('--ring-deadzone'),
        label: `${prefix}deadzone ${limits.deadzone}`,
        setting: prefix + 'deadzone',
      });
    }

    const maxOffset = Math.round(cameraOffsetAt(limits.effectiveMax, limits));
    if (maxOffset > 0) {
      rings.push({
        radius: maxOffset,
        color: this.colorOf('--ring-camera-offset'),
        label: `max camera offset ${maxOffset}`,
        dotted: true,
        setting: followFactorSetting,
      });
    }

    return rings.filter((ring) => ring.radius > 0);
  }

  /**
   * Draws the circles centered on the tee. Labels go above a circle, or below when there is no room,
   * and are skipped when they would overlap another label.
   * The circles are drawn once into a cached canvas and reused while nothing changes.
   */
  drawRings(limits, center, onlySetting) {
    let rings = this.rings(limits);
    if (onlySetting) rings = rings.filter((ring) => ring.setting === onlySetting);
    if (!rings.length) return;

    const ratio = this.pixelRatio;
    const canvasHeight = this.canvas.height;
    const lineHeight = 15 * ratio;
    const placed = [];
    const labelled = [...rings]
      .sort((a, b) => b.radius - a.radius)
      .map((ring) => {
        const radius = ring.radius * this.scale + 4 * ratio;
        let side = '';
        if (center.y - radius - 14 * ratio >= 0) side = 'top';
        else if (center.y + radius + 16 * ratio <= canvasHeight) side = 'bottom';
        if (!side || placed.some((other) => other.side === side && Math.abs(other.radius - radius) < lineHeight)) {
          return { ring, side: '' };
        }
        placed.push({ radius, side });
        return { ring, side };
      });

    const cacheKey = JSON.stringify([
      labelled.map(({ ring, side }) => [ring.radius, ring.label, side, ring.faint, ring.dotted]),
      this.scale,
      ratio,
      this.font,
    ]);
    if (this.ringCache?.key !== cacheKey) {
      const outerRadius = Math.max(...rings.map((ring) => ring.radius)) * this.scale + 30 * ratio;
      const size = Math.ceil(outerRadius * 2);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      const middle = size / 2;

      for (const ring of rings) {
        context.save();
        context.globalAlpha = ring.faint ? 0.6 : 1;
        context.setLineDash(ring.dotted ? [2 * ratio, 5 * ratio] : ring.faint ? [7 * ratio, 6 * ratio] : []);
        context.beginPath();
        context.arc(middle, middle, ring.radius * this.scale, 0, Math.PI * 2);
        context.lineWidth = (ring.faint ? 3 : 4.2) * ratio;
        context.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        context.stroke();
        context.lineWidth = (ring.faint ? 1.5 : 2.2) * ratio;
        context.strokeStyle = ring.color;
        context.stroke();
        context.restore();
      }

      context.font = `${11.5 * ratio}px ${this.font}`;
      for (const { ring, side } of labelled) {
        if (!side) continue;
        context.save();
        context.globalAlpha = ring.faint ? 0.8 : 1;
        this.drawArcLabel(context, ring.label, middle, ring.radius * this.scale + 4 * ratio, ring.color, side === 'top');
        context.restore();
      }
      this.ringCache = { key: cacheKey, canvas, middle };
    }

    this.context.drawImage(this.ringCache.canvas, Math.round(center.x - this.ringCache.middle), Math.round(center.y - this.ringCache.middle));

    // Cross at the screen center: where the camera looks
    if (!onlySetting) {
      const context = this.context;
      const arm = 7 * ratio;
      const middleX = this.canvas.width / 2;
      const middleY = this.canvas.height / 2;
      context.save();
      context.lineWidth = 2 * ratio;
      context.strokeStyle = this.colorOf('--ring-camera-offset');
      context.beginPath();
      context.moveTo(middleX - arm, middleY);
      context.lineTo(middleX + arm, middleY);
      context.moveTo(middleX, middleY - arm);
      context.lineTo(middleX, middleY + arm);
      context.stroke();
      context.restore();
    }
  }

  /** Writes text along a circle of radius `radius` around (middle, middle), centered at its top or bottom. */
  drawArcLabel(context, text, middle, radius, color, onTop) {
    const totalAngle = context.measureText(text).width / radius;
    if (totalAngle > Math.PI * 1.6) return;

    context.textAlign = 'center';
    context.textBaseline = onTop ? 'alphabetic' : 'top';
    context.lineJoin = 'round';
    context.lineWidth = 3.5 * this.pixelRatio;
    context.strokeStyle = 'rgba(0, 0, 0, 0.75)';

    // Text reads left to right on both sides, so it runs clockwise on top and counterclockwise below.
    const direction = onTop ? 1 : -1;
    let angle = onTop ? -Math.PI / 2 - totalAngle / 2 : Math.PI / 2 + totalAngle / 2;
    for (const character of text) {
      const characterAngle = context.measureText(character).width / radius;
      const center = angle + (direction * characterAngle) / 2;
      context.save();
      context.translate(middle + radius * Math.cos(center), middle + radius * Math.sin(center));
      context.rotate(center + (direction * Math.PI) / 2);
      context.strokeText(character, 0, 0);
      context.fillStyle = color;
      context.fillText(character, 0, 0);
      context.restore();
      angle += direction * characterAngle;
    }
  }
}
