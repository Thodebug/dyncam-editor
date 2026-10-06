import { CameraSmoothing, cameraOffsetAt, cursorFromMouse, cursorLimits } from './camera.js';
import { PRIMITIVE_STRIDE } from './graphics.js';
import { calcScreenParams, mapScreenToWorld } from './map-renderer.js';
import { gameTick } from './player.js';

/** Visible world size at zoom 1 for a screen aspect ratio (width / height), from IGraphics::CalcScreenParams(). */
export function screenSize(aspect) {
  return calcScreenParams(aspect, 1);
}

/** Screen formats, with the aspect ratio of the window width / height in pixels, as in IGraphics::ScreenAspect(). */
export const SCREEN_FORMATS = [
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: '16:10', label: '16:10', aspect: 16 / 10 },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
  { id: '21:9', label: '21:9 (2560×1080)', aspect: 2560 / 1080 },
  { id: '21:9-wide', label: '21:9 (3440×1440)', aspect: 3440 / 1440 },
];

/** The tee stands on the ctf5 platform at tile (162, 55). */
export const TEE_POSITION = { x: 5200, y: 1777 };

/**
 * The game view as DDNet renders it: map, laser, hook, tee, map foreground and cursor, drawn with WebGL.
 * The distance circles and the help text are drawn on 2D canvases and shown over the game as textures.
 */
export class GameView {
  /**
   * graphics: Graphics, map: MapRenderer, renderer: TeeRenderer, store: ConfigStore,
   * pointer: PointerInput, player: Player
   */
  constructor({ canvas, graphics, map, renderer, store, pointer, player }) {
    this.canvas = canvas;
    this.graphics = graphics;
    this.map = map;
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
    this.overlays = {};
    this.overlayVertices = new Float32Array(6 * PRIMITIVE_STRIDE);
    this.frameRequest = 0;
    this.blinkTimer = 0;
    this.contextLost = false;

    const style = getComputedStyle(document.documentElement);
    this.font = style.getPropertyValue('--font').trim();
    this.colorOf = (variable) => style.getPropertyValue(variable).trim();

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.graphics.init();
      this.map.upload();
      this.renderer.upload();
      this.overlays = {};
      this.contextLost = false;
      this.requestRender();
    });
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
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.requestRender();
  }

  render({ hideHint = false } = {}) {
    this.frameRequest = 0;
    const { width, height } = this.canvas;
    if (!width || !height || this.contextLost) return;
    const graphics = this.graphics;

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

    graphics.setViewport(width, height);
    graphics.setBlend('normal');
    graphics.clear(0, 0, 0);

    // Map behind the players, then the laser, the hook and the tee, then the map in front (CGameClient::OnRender order)
    const center = { x: TEE_POSITION.x + offset.x, y: TEE_POSITION.y + offset.y };
    this.map.render('background', center, this.aspect);

    const world = mapScreenToWorld(center.x, center.y, 100, 100, 100, 0, 0, this.aspect, 1);
    graphics.mapScreen(world.left, world.top, world.right, world.bottom);
    const tick = gameTick(now);
    this.player.update(now, cursor.position);
    for (const segment of this.player.laser.visibleSegments(tick)) {
      this.renderer.drawLaser(segment.from, segment.to, segment.width, tick);
    }
    const hookPosition = this.player.hook.positionAt(tick);
    if (hookPosition) this.renderer.drawHook(TEE_POSITION, hookPosition);
    this.renderer.drawPlayer(TEE_POSITION, cursor.direction, this.player.weapon, this.player.pose(now));

    this.map.render('foreground', center, this.aspect);

    // Distance circles around the tee, all of them or the one of the hovered setting
    graphics.mapScreen(0, 0, width, height);
    const teeOnCanvas = { x: width / 2 - offset.x * this.scale, y: height / 2 - offset.y * this.scale };
    if (this.showDistances) this.drawRings(limits, teeOnCanvas, null);
    else if (this.focusedSetting) this.drawRings(limits, teeOnCanvas, this.focusedSetting);

    // The cursor is part of the HUD, drawn at zoom 1 (CHud::RenderCursor())
    graphics.mapScreen(world.left, world.top, world.right, world.bottom);
    const target = { x: TEE_POSITION.x + cursor.position.x, y: TEE_POSITION.y + cursor.position.y };
    this.renderer.drawCursor(target, this.player.weapon);

    const hint = hideHint ? '' : this.pointer.hint();
    if (hint) {
      graphics.mapScreen(0, 0, width, height);
      this.drawHint(hint);
    }

    if (cameraMoving || this.player.isAnimating(now)) {
      this.requestRender();
    } else {
      // Nothing moves: the next change is the tee's blink.
      clearTimeout(this.blinkTimer);
      this.blinkTimer = setTimeout(() => this.requestRender(), this.player.msUntilBlinkChange(now) + 1);
    }
  }

  /* ---------- Drawings over the game ---------- */

  /**
   * A 2D canvas of `width` × `height` pixels shown as a texture, drawn by draw(context) again only when `key` changes.
   */
  overlay(name, key, width, height, draw) {
    let overlay = this.overlays[name];
    if (overlay?.key === key) return overlay;
    const canvas = overlay?.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    draw(context);
    if (overlay) {
      this.graphics.updateTexture(overlay.texture, canvas, { premultiplied: true });
    } else {
      overlay = { canvas, texture: this.graphics.createTexture(canvas, { mipmaps: false, premultiplied: true }) };
      this.overlays[name] = overlay;
    }
    overlay.key = key;
    return overlay;
  }

  /** Draws an overlay with its top left corner at canvas pixel (x, y), in a screen mapped to canvas pixels. */
  drawOverlay(overlay, x, y) {
    const left = Math.round(x);
    const top = Math.round(y);
    const right = left + overlay.canvas.width;
    const bottom = top + overlay.canvas.height;
    const corners = [
      [left, top, 0, 0],
      [right, top, 1, 0],
      [right, bottom, 1, 1],
      [left, bottom, 0, 1],
    ];
    const vertices = this.overlayVertices;
    [0, 1, 2, 0, 2, 3].forEach((corner, i) => {
      vertices.set(corners[corner], i * PRIMITIVE_STRIDE);
      vertices.set([1, 1, 1, 1], i * PRIMITIVE_STRIDE + 4);
    });
    this.graphics.setBlend('premultiplied');
    this.graphics.drawPrimitives(vertices, 6, overlay.texture);
    this.graphics.setBlend('normal');
  }

  drawHint(text) {
    const ratio = this.pixelRatio;
    const font = `${14 * ratio}px ${this.font}`;
    this.measureContext ??= document.createElement('canvas').getContext('2d');
    this.measureContext.font = font;
    const boxWidth = Math.ceil(this.measureContext.measureText(text).width + 24 * ratio);
    const boxHeight = Math.ceil(28 * ratio);
    const overlay = this.overlay('hint', JSON.stringify([text, ratio, this.font]), boxWidth, boxHeight, (context) => {
      context.fillStyle = 'rgba(51, 51, 51, 0.8)';
      context.beginPath();
      context.roundRect(0, 0, boxWidth, boxHeight, 8 * ratio);
      context.fill();
      context.font = font;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#fff';
      context.fillText(text, boxWidth / 2, boxHeight / 2);
    });
    this.drawOverlay(overlay, this.canvas.width / 2 - boxWidth / 2, this.canvas.height * 0.82 - boxHeight / 2);
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
   * The circles are drawn on a canvas that is reused while nothing changes.
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

    const key = JSON.stringify([
      labelled.map(({ ring, side }) => [ring.radius, ring.label, side, ring.faint, ring.dotted, ring.color]),
      this.scale,
      ratio,
      this.font,
    ]);
    const size = Math.ceil((Math.max(...rings.map((ring) => ring.radius)) * this.scale + 30 * ratio) * 2);
    const middle = size / 2;
    const overlay = this.overlay('rings', key, size, size, (context) => {
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
    });
    this.drawOverlay(overlay, center.x - middle, center.y - middle);

    // Cross at the screen center: where the camera looks
    if (!onlySetting) {
      const arm = 7 * ratio;
      const crossSize = Math.ceil(arm * 2 + 4 * ratio);
      const color = this.colorOf('--ring-camera-offset');
      const cross = this.overlay('cross', JSON.stringify([ratio, color]), crossSize, crossSize, (context) => {
        const half = crossSize / 2;
        context.lineWidth = 2 * ratio;
        context.strokeStyle = color;
        context.beginPath();
        context.moveTo(half - arm, half);
        context.lineTo(half + arm, half);
        context.moveTo(half, half - arm);
        context.lineTo(half, half + arm);
        context.stroke();
      });
      this.drawOverlay(cross, this.canvas.width / 2 - crossSize / 2, this.canvas.height / 2 - crossSize / 2);
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
