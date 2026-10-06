import { CameraSmoothing, cameraOffsetAt, cursorFromMouse, cursorLimits } from './camera.js';
import { TICK_MS } from './laser.js';

/** Visible world size at zoom 1 on a 16:9 screen (CRenderTools::CalcScreenParams). */
export const SCREEN_WIDTH = 1429.84;
export const SCREEN_HEIGHT = (SCREEN_WIDTH * 9) / 16;

/** The tee stands on the ctf5 platform at tile (162, 55). */
export const TEE_POSITION = { x: 5200, y: 1777 };

/** hook_length (tuning) */
const HOOK_LENGTH = 380;

/**
 * The map layers are screenshots of the game taken with the camera at CAPTURE_CAMERA and a zoom of
 * CAPTURE_ZOOM, one image per group of layers. Each image is drawn with the parallax of its group.
 */
const CAPTURE_CAMERA = { x: 5200, y: 1776 };
const CAPTURE_ZOOM = Math.pow(0.866025, -3);
const LAYERS_BEHIND = [
  { name: 'clouds-far', parallaxX: 49, parallaxY: 51 },
  { name: 'clouds-near', parallaxX: 70, parallaxY: 70 },
  { name: 'cave', parallaxX: 96, parallaxY: 96 },
  { name: 'background', parallaxX: 100, parallaxY: 100 },
];
const LAYERS_IN_FRONT = [{ name: 'foreground', parallaxX: 100, parallaxY: 100 }];

/** Canvas showing the game as DDNet renders it: map, tee, laser, hook, cursor and distance circles. */
export class GameView {
  /**
   * images: map layers by name (plus 'sky'), renderer: TeeRenderer,
   * store: ConfigStore, pointer: PointerInput, laserGun: LaserGun
   */
  constructor({ canvas, images, renderer, store, pointer, laserGun }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.images = images;
    this.renderer = renderer;
    this.store = store;
    this.pointer = pointer;
    this.laserGun = laserGun;
    this.camera = new CameraSmoothing();

    this.showDistances = false;
    this.focusedSetting = null;
    this.onFrame = null;

    this.pixelRatio = 1;
    this.scale = 1;
    this.scaledLayers = null;
    this.ringCache = null;
    this.frameRequest = 0;

    const style = getComputedStyle(document.documentElement);
    this.font = style.getPropertyValue('--font').trim();
    this.colorOf = (variable) => style.getPropertyValue(variable).trim();
  }

  requestRender() {
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(() => this.render());
  }

  /** Matches the canvas resolution to its size on screen. */
  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width) return;
    this.pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * this.pixelRatio));
    const height = Math.max(1, Math.round(((box.width * 9) / 16) * this.pixelRatio));
    if (width === this.canvas.width && height === this.canvas.height && this.scaledLayers) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.scaledLayers = null;
    this.ringCache = null;
    this.requestRender();
  }

  /** Resamples each layer once for the current canvas size, so frames only copy pixels. */
  scaleLayers() {
    const { width, height } = this.canvas;
    const resample = (image, targetWidth, targetHeight) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(targetWidth));
      canvas.height = Math.max(1, Math.round(targetHeight));
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    };

    // CRenderTools::MapScreenToWorld: a layer with parallax p is zoomed by (p × (zoom − 1) + 100) / 100.
    const layers = { sky: resample(this.images.sky, width, height) };
    for (const layer of [...LAYERS_BEHIND, ...LAYERS_IN_FRONT]) {
      const parallax = Math.min(Math.max(layer.parallaxX, layer.parallaxY), 100);
      const factor = (parallax * (CAPTURE_ZOOM - 1) + 100) / 100;
      layers[layer.name] = resample(this.images[layer.name], width * factor, height * factor);
    }
    this.scaledLayers = layers;
  }

  /** Draws a layer for a camera at `camera` units from CAPTURE_CAMERA. */
  drawLayer(layer, camera) {
    const image = this.scaledLayers[layer.name];
    const { width, height } = this.canvas;
    const x = width / 2 - image.width / 2 - ((camera.x * layer.parallaxX) / 100) * this.scale;
    const y = height / 2 - image.height / 2 - ((camera.y * layer.parallaxY) / 100) * this.scale;
    this.context.drawImage(image, Math.round(x), Math.round(y));
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
    this.scale = width / SCREEN_WIDTH;
    this.onFrame?.({ cursor, limits, offset });

    if (!this.scaledLayers) this.scaleLayers();

    // Map behind the tee
    const layerCamera = {
      x: offset.x + TEE_POSITION.x - CAPTURE_CAMERA.x,
      y: offset.y + TEE_POSITION.y - CAPTURE_CAMERA.y,
    };
    context.drawImage(this.scaledLayers.sky, 0, 0);
    for (const layer of LAYERS_BEHIND) this.drawLayer(layer, layerCamera);

    // Items, then the player, as in the game
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const view = {
      scale: this.scale,
      originX: width / 2 - (TEE_POSITION.x + offset.x) * this.scale,
      originY: height / 2 - (TEE_POSITION.y + offset.y) * this.scale,
    };
    this.laserGun.update(now, cursor.position);
    for (const segment of this.laserGun.visibleSegments(now)) {
      this.renderer.drawLaser(context, view, segment.from, segment.to, segment.width, now / TICK_MS);
    }
    if (this.pointer.hookHeld) this.renderer.drawHook(context, view, TEE_POSITION, cursor.direction, HOOK_LENGTH);
    this.renderer.drawPlayer(context, view, TEE_POSITION, cursor.direction, this.pointer.weapon);

    // Map in front of the tee
    for (const layer of LAYERS_IN_FRONT) this.drawLayer(layer, layerCamera);

    // Distance circles around the tee, all of them or the one of the hovered setting
    const teeOnCanvas = { x: width / 2 - offset.x * this.scale, y: height / 2 - offset.y * this.scale };
    if (this.showDistances) this.drawRings(limits, teeOnCanvas, null);
    else if (this.focusedSetting) this.drawRings(limits, teeOnCanvas, this.focusedSetting);

    const cursorOffset = { x: cursor.position.x - offset.x, y: cursor.position.y - offset.y };
    this.renderer.drawCursor(context, { x: width / 2, y: height / 2 }, cursorOffset, this.scale, this.pointer.weapon);

    const hint = hideHint ? '' : this.pointer.hint();
    if (hint) this.drawHint(hint);

    if (cameraMoving || this.laserGun.isActive()) this.requestRender();
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
