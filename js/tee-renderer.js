import { PRIMITIVE_STRIDE, colorByte } from './graphics.js';

/**
 * Draws the tee, its weapon, the hook, the laser and the cursor with the game's own sprites,
 * at the sizes and positions used by the DDNet client
 * (src/game/client/render.cpp RenderTee6, components/players.cpp, items.cpp, hud.cpp).
 *
 * Like the client, each sprite is its own texture cut from the sprite sheet (LoadSpriteTexture()),
 * drawn as a quad of a quad container: the quad turns around its center, is scaled, then moved to its position
 * (RenderQuadContainerEx()). Positions are in world units, in the screen mapped by Graphics.mapScreen().
 */

/** Sprites in game.png (grid of 32 × 16 cells) and their size in game (datasrc/content.py). */
const WEAPONS = {
  hammer: { sprite: [2, 1, 4, 3], cursor: [0, 0, 2, 2], visualSize: 96, offsetX: 4, offsetY: -20 },
  laser: { sprite: [2, 12, 7, 3], cursor: [0, 12, 2, 2], visualSize: 92, offsetX: 24, offsetY: -2 },
};

/** Default cl_laser_rifle_outline_color and cl_laser_rifle_inner_color (packed HSL). */
const LASER_OUTLINE_COLOR = 11176233;
const LASER_INNER_COLOR = 11206591;

/** Texture coordinates of the corners top left, top right, bottom right, bottom left (QuadsSetSubset()). */
const SUBSET_NORMAL = [0, 0, 1, 0, 1, 1, 0, 1];
const SUBSET_FLIP_Y = [0, 1, 1, 1, 1, 0, 0, 0];

/** ColorHSLA(packed) converted to RGB (color_cast in src/base/color.h), each channel from 0 to 1. */
function packedHslToRgb(packed) {
  const f = Math.fround;
  const hue = f(((packed >> 16) & 255) / 255);
  const saturation = f(((packed >> 8) & 255) / 255);
  const lightness = f((packed & 255) / 255);

  const sector = f(hue * 6);
  const chroma = f(f(1 - Math.abs(f(2 * lightness) - 1)) * saturation);
  const second = f(chroma * f(1 - Math.abs(f(sector % 2) - 1)));
  let rgb;
  switch (Math.trunc(sector)) {
    case 0: rgb = [chroma, second, 0]; break;
    case 1: rgb = [second, chroma, 0]; break;
    case 2: rgb = [0, chroma, second]; break;
    case 3: rgb = [0, second, chroma]; break;
    case 4: rgb = [second, 0, chroma]; break;
    default: rgb = [chroma, 0, second]; break;
  }
  const match = f(lightness - f(chroma / 2));
  return rgb.map((channel) => f(channel + match));
}

/** CImageInfo::CopyRectFrom(): a rectangle of RGBA pixels. */
function cropPixels(pixels, x, y, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * pixels.width + x) * 4;
    data.set(pixels.data.subarray(start, start + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/** Quad of a quad container: top left corner, size and texture coordinates (QuadContainerAddSprite()). */
function containerQuad(x, y, width, height, subset = SUBSET_NORMAL) {
  return { x, y, width, height, subset };
}

const centeredQuad = (width, height, subset) => containerQuad(-width / 2, -height / 2, width, height, subset);

const FOOT_QUAD = containerQuad(-32, -16, 64, 32);
const BODY_QUAD = centeredQuad(64, 64);
const EYE_QUAD = centeredQuad(64 * 0.4, 64 * 0.4);
const HAND_QUAD = centeredQuad(20, 20);
const HOOK_QUAD = containerQuad(-12, -8, 24, 16);
const SPLAT_QUAD = centeredQuad(24, 24);

const WHITE = [1, 1, 1, 1];
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3];
const FREEFORM_TRIANGLES = [0, 1, 3, 0, 3, 2];

export class TeeRenderer {
  /** graphics: Graphics. skin: data/skins/default.png, game: data/game.png, particles: data/particles.png */
  constructor(graphics, { skin, game, particles }) {
    this.graphics = graphics;
    this.images = { skin, game, particles };
    this.vertices = new Float32Array(6 * PRIMITIVE_STRIDE);
    this.corners = new Float32Array(16);
    this.laserOutline = packedHslToRgb(LASER_OUTLINE_COLOR);
    this.laserInner = packedHslToRgb(LASER_INNER_COLOR);
    this.upload();
  }

  /** Creates the sprite textures. Called again after the WebGL context is restored. */
  upload() {
    const graphics = this.graphics;
    const sheet = (image, gridX, gridY) => {
      const pixels = graphics.readImagePixels(image);
      const cellWidth = pixels.width / gridX;
      const cellHeight = pixels.height / gridY;
      return ([x, y, width, height]) =>
        graphics.createTexture(cropPixels(pixels, x * cellWidth, y * cellHeight, width * cellWidth, height * cellHeight));
    };

    // Skin sprites (grid of 8 × 4 cells)
    const skinSprite = sheet(this.images.skin, 8, 4);
    this.body = skinSprite([0, 0, 3, 3]);
    this.bodyOutline = skinSprite([3, 0, 3, 3]);
    this.foot = skinSprite([6, 1, 2, 1]);
    this.footOutline = skinSprite([6, 2, 2, 1]);
    this.hand = skinSprite([6, 0, 1, 1]);
    this.handOutline = skinSprite([7, 0, 1, 1]);
    this.eye = skinSprite([2, 3, 1, 1]);

    const gameSprite = sheet(this.images.game, 32, 16);
    this.weapons = {};
    for (const [name, weapon] of Object.entries(WEAPONS)) {
      // GetSpriteScale(): the sprite's width and height divided by the length of its diagonal
      const [, , spriteWidth, spriteHeight] = weapon.sprite;
      const spriteScale = weapon.visualSize / Math.hypot(spriteWidth, spriteHeight);
      const [, , cursorWidth, cursorHeight] = weapon.cursor;
      const cursorScale = 64 / Math.hypot(cursorWidth, cursorHeight);
      this.weapons[name] = {
        texture: gameSprite(weapon.sprite),
        quad: centeredQuad(spriteWidth * spriteScale, spriteHeight * spriteScale),
        flippedQuad: centeredQuad(spriteWidth * spriteScale, spriteHeight * spriteScale, SUBSET_FLIP_Y),
        offsetX: weapon.offsetX,
        offsetY: weapon.offsetY,
        cursor: gameSprite(weapon.cursor),
        cursorQuad: centeredQuad(cursorWidth * cursorScale, cursorHeight * cursorScale),
      };
    }
    this.hookHead = gameSprite([3, 0, 2, 1]);
    this.hookChain = gameSprite([2, 0, 1, 1]);

    // part_splat01..03 in particles.png (8 × 8 cells)
    const particleSprite = sheet(this.images.particles, 8, 8);
    this.splats = [0, 1, 2].map((i) => particleSprite([2 + i, 0, 1, 1]));
  }

  /**
   * RenderQuadContainerEx(): `quad` turned by `rotation` around its center, scaled, then moved to (x, y),
   * with the color (RGBA from 0 to 1) stored as bytes like Graphics()->SetColor().
   */
  drawQuad(texture, quad, x, y, { scaleX = 1, scaleY = 1, rotation = 0, color = WHITE } = {}) {
    const centerX = quad.x + quad.width / 2;
    const centerY = quad.y + quad.height / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const corners = this.corners;
    for (let corner = 0; corner < 4; corner++) {
      let px = corner === 1 || corner === 2 ? quad.x + quad.width : quad.x;
      let py = corner >= 2 ? quad.y + quad.height : quad.y;
      if (rotation !== 0) {
        const dx = px - centerX;
        const dy = py - centerY;
        px = dx * cos - dy * sin + centerX;
        py = dx * sin + dy * cos + centerY;
      }
      corners[corner * 4] = px * scaleX + x;
      corners[corner * 4 + 1] = py * scaleY + y;
      corners[corner * 4 + 2] = quad.subset[corner * 2];
      corners[corner * 4 + 3] = quad.subset[corner * 2 + 1];
    }
    // Corners top left, top right, bottom right, bottom left: triangles (0, 1, 2) and (0, 2, 3)
    this.drawCorners(QUAD_TRIANGLES, color, texture);
  }

  /** Untextured quad with corners p0, p1, p2, p3 (IGraphics::CFreeformItem): triangles (0, 1, 3) and (0, 3, 2). */
  drawFreeform(p0, p1, p2, p3, color) {
    const corners = this.corners;
    [p0, p1, p2, p3].forEach((point, corner) => {
      corners[corner * 4] = point.x;
      corners[corner * 4 + 1] = point.y;
      corners[corner * 4 + 2] = 0;
      corners[corner * 4 + 3] = 0;
    });
    this.drawCorners(FREEFORM_TRIANGLES, color, null);
  }

  /** Two triangles from this.corners (x, y, u, v for each corner), in the order of `order`. */
  drawCorners(order, color, texture) {
    const vertices = this.vertices;
    const corners = this.corners;
    order.forEach((corner, i) => {
      const offset = i * PRIMITIVE_STRIDE;
      for (let n = 0; n < 4; n++) vertices[offset + n] = corners[corner * 4 + n];
      for (let n = 0; n < 4; n++) vertices[offset + 4 + n] = colorByte(color[n]) / 255;
    });
    this.graphics.drawPrimitives(vertices, 6, texture);
  }

  /**
   * CPlayers::RenderPlayer() for a tee standing still at `position`, aiming along `direction` (unit vector),
   * holding `weaponName`. pose: { recoil, hammerAngle, blinking } from Player.pose().
   */
  drawPlayer(position, direction, weaponName, pose) {
    const weapon = this.weapons[weaponName];
    const facingLeft = direction.x < 0;
    const quad = facingLeft ? weapon.flippedQuad : weapon.quad;

    // The weapon is drawn behind the tee.
    if (weaponName === 'hammer') {
      const x = facingLeft ? position.x - weapon.offsetX : position.x;
      const y = position.y + weapon.offsetY;
      const swing = pose.hammerAngle * Math.PI * 2;
      const rotation = facingLeft ? -Math.PI / 2 - swing : -Math.PI / 2 + swing;
      this.drawQuad(weapon.texture, quad, x, y, { rotation });
    } else {
      const x = position.x + direction.x * weapon.offsetX - direction.x * pose.recoil * 10;
      const y = position.y + direction.y * weapon.offsetX - direction.y * pose.recoil * 10 + weapon.offsetY;
      this.drawQuad(weapon.texture, quad, x, y, { rotation: Math.atan2(direction.y, direction.x) });
    }

    // RenderTee6(): outlines first, then the filling. Each pass draws the back foot, the body, the eyes, the front foot.
    const body = { x: position.x, y: position.y - 4 };
    for (const outline of [true, false]) {
      const foot = outline ? this.footOutline : this.foot;
      this.drawQuad(foot, FOOT_QUAD, position.x - 7, position.y + 10);
      this.drawQuad(outline ? this.bodyOutline : this.body, BODY_QUAD, body.x, body.y);
      if (!outline) {
        const eyeSize = 64 * 0.4;
        const eyeHeight = pose.blinking ? 64 * 0.15 : eyeSize;
        const separation = (0.075 - 0.01 * Math.abs(direction.x)) * 64;
        const eyeX = body.x + direction.x * 0.125 * 64;
        const eyeY = body.y + (-0.05 + direction.y * 0.1) * 64;
        const scaleY = eyeHeight / eyeSize;
        this.drawQuad(this.eye, EYE_QUAD, eyeX - separation, eyeY, { scaleY });
        this.drawQuad(this.eye, EYE_QUAD, eyeX + separation, eyeY, { scaleX: -1, scaleY });
      }
      this.drawQuad(foot, FOOT_QUAD, position.x + 7, position.y + 10);
    }
  }

  /** CPlayers::RenderHook(): hook head at `hookPosition`, chain links every 24 units back to the tee, then the hand. */
  drawHook(position, hookPosition) {
    const distance = Math.hypot(position.x - hookPosition.x, position.y - hookPosition.y);
    if (distance === 0) return;
    const back = { x: (position.x - hookPosition.x) / distance, y: (position.y - hookPosition.y) / distance };
    const rotation = Math.atan2(back.y, back.x) + Math.PI;
    this.drawQuad(this.hookHead, HOOK_QUAD, hookPosition.x, hookPosition.y, { rotation });
    for (let step = 24; step < distance; step += 24) {
      this.drawQuad(this.hookChain, HOOK_QUAD, hookPosition.x + back.x * step, hookPosition.y + back.y * step, {
        rotation,
      });
    }

    // RenderHand(): angle offset −π/2, then 20 units along the hook direction
    const toward = { x: -back.x, y: -back.y };
    const aim = Math.atan2(toward.y, toward.x);
    const handRotation = toward.x < 0 ? aim + Math.PI / 2 : aim - Math.PI / 2;
    const handX = position.x + toward.x + toward.x * 20;
    const handY = position.y + toward.y + toward.y * 20;
    this.drawQuad(this.handOutline, HAND_QUAD, handX, handY, { rotation: handRotation });
    this.drawQuad(this.hand, HAND_QUAD, handX, handY, { rotation: handRotation });
  }

  /**
   * CItems::RenderLaser() for a rifle laser: a body from `from` to `to`, `width` from 1 (just fired) to 0,
   * and a turning splat at the end. `ticks` is the current game time in ticks.
   */
  drawLaser(from, to, width, ticks) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0) {
      const direction = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
      const side = (halfWidth) => ({ x: direction.y * halfWidth, y: -direction.x * halfWidth });
      const plus = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
      const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

      let out = side(7 * width);
      this.drawFreeform(minus(from, out), plus(from, out), minus(to, out), plus(to, out), [...this.laserOutline, 1]);

      out = side(5 * width);
      const start = plus(from, direction);
      const end = minus(to, direction);
      this.drawFreeform(minus(start, out), plus(start, out), minus(end, out), plus(end, out), [...this.laserInner, 1]);
    }

    const tick = Math.trunc(ticks);
    const splat = this.splats[tick % 3];
    this.drawQuad(splat, SPLAT_QUAD, to.x, to.y, { rotation: tick, color: [...this.laserOutline, 1] });
    this.drawQuad(splat, SPLAT_QUAD, to.x, to.y, {
      rotation: tick,
      scaleX: 20 / 24,
      scaleY: 20 / 24,
      color: [...this.laserInner, 1],
    });
  }

  /** CHud::RenderCursor(): the weapon's cursor at `target` (world position, in a screen mapped at zoom 1). */
  drawCursor(target, weaponName) {
    const weapon = this.weapons[weaponName];
    this.drawQuad(weapon.cursor, weapon.cursorQuad, target.x, target.y);
  }
}
