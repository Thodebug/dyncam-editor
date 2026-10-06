/**
 * Draws the tee, its weapon, the hook, the laser and the cursor with the game's own sprites,
 * at the sizes and positions used by the DDNet client
 * (src/game/client/render.cpp RenderTee6, players.cpp, items.cpp, hud.cpp).
 *
 * World coordinates are in units. A `view` maps them to canvas pixels:
 * canvasX = view.originX + worldX * view.scale.
 */

/** Sprites in game.png (grid of 32 × 16 cells) and their size in game (datasrc/content.py). */
const WEAPONS = {
  hammer: { sprite: [2, 1, 4, 3], cursor: [0, 0, 2, 2], visualSize: 96, offsetX: 4, offsetY: -20 },
  laser: { sprite: [2, 12, 7, 3], cursor: [0, 12, 2, 2], visualSize: 92, offsetX: 24, offsetY: -2 },
};

const CURSOR_SIZE = 64;
const HAND_SIZE = 20;
const HOOK_SIZE = { width: 24, height: 16 };

/** Default cl_laser_rifle_outline_color and cl_laser_rifle_inner_color (packed HSL). */
const LASER_OUTLINE_COLOR = 11176233;
const LASER_INNER_COLOR = 11206591;

/** ColorHSLA(packed) converted to RGB, each channel from 0 to 1. */
function packedHslToRgb(packed) {
  const hue = ((packed >> 16) & 255) / 255;
  const saturation = ((packed >> 8) & 255) / 255;
  const lightness = (packed & 255) / 255;

  const sector = hue * 6;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  let rgb;
  switch (Math.trunc(sector)) {
    case 0: rgb = [chroma, second, 0]; break;
    case 1: rgb = [second, chroma, 0]; break;
    case 2: rgb = [0, chroma, second]; break;
    case 3: rgb = [0, second, chroma]; break;
    case 4: rgb = [second, 0, chroma]; break;
    default: rgb = [chroma, 0, second]; break;
  }
  const match = lightness - chroma / 2;
  return rgb.map((channel) => channel + match);
}

function cssColor(rgb) {
  return `rgb(${rgb.map((channel) => Math.round(channel * 255)).join(',')})`;
}

/** Copies a rectangle of an image into its own canvas. */
function cropImage(image, x, y, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas;
}

/** Multiplies the colors of an image, like Graphics()->SetColor() does on a texture. */
function tintImage(image, rgb) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] *= rgb[0];
    data[i + 1] *= rgb[1];
    data[i + 2] *= rgb[2];
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export class TeeRenderer {
  /** skin: data/skins/default.png, game: data/game.png, particles: data/particles.png */
  constructor({ skin, game, particles }) {
    const skinCell = skin.width / 8;
    const skinPart = (x, y, width, height) =>
      cropImage(skin, x * skinCell, y * skinCell, width * skinCell, height * skinCell);
    this.body = skinPart(0, 0, 3, 3);
    this.bodyOutline = skinPart(3, 0, 3, 3);
    this.foot = skinPart(6, 1, 2, 1);
    this.footOutline = skinPart(6, 2, 2, 1);
    this.hand = skinPart(6, 0, 1, 1);
    this.handOutline = skinPart(7, 0, 1, 1);
    this.eye = skinPart(2, 3, 1, 1);

    const gameCell = game.width / 32;
    const gamePart = ([x, y, width, height]) =>
      cropImage(game, x * gameCell, y * gameCell, width * gameCell, height * gameCell);
    this.weapons = {};
    for (const [name, weapon] of Object.entries(WEAPONS)) {
      const [, , spriteWidth, spriteHeight] = weapon.sprite;
      const [, , cursorWidth, cursorHeight] = weapon.cursor;
      const spriteScale = weapon.visualSize / Math.hypot(spriteWidth, spriteHeight);
      this.weapons[name] = {
        image: gamePart(weapon.sprite),
        width: spriteWidth * spriteScale,
        height: spriteHeight * spriteScale,
        offsetX: weapon.offsetX,
        offsetY: weapon.offsetY,
        cursor: gamePart(weapon.cursor),
        cursorSize: (CURSOR_SIZE * cursorWidth) / Math.hypot(cursorWidth, cursorHeight),
      };
    }
    this.hookHead = gamePart([3, 0, 2, 1]);
    this.hookChain = gamePart([2, 0, 1, 1]);

    // part_splat01..03 in particles.png (8 × 8 cells), tinted with the laser colors
    const particleCell = particles.width / 8;
    const splats = [0, 1, 2].map((i) => cropImage(particles, (2 + i) * particleCell, 0, particleCell, particleCell));
    this.laserOutline = packedHslToRgb(LASER_OUTLINE_COLOR);
    this.laserInner = packedHslToRgb(LASER_INNER_COLOR);
    this.splatsOutline = splats.map((splat) => tintImage(splat, this.laserOutline));
    this.splatsInner = splats.map((splat) => tintImage(splat, this.laserInner));
  }

  /** Draws an image centered on a world position, with a size in units, a rotation and flips. */
  drawSprite(context, view, image, x, y, width, height, rotation = 0, flipX = false, flipY = false) {
    context.save();
    context.translate(view.originX + x * view.scale, view.originY + y * view.scale);
    if (rotation) context.rotate(rotation);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(image, (-width / 2) * view.scale, (-height / 2) * view.scale, width * view.scale, height * view.scale);
    context.restore();
  }

  /**
   * Tee standing still at `position`, aiming along `direction` (unit vector), holding `weaponName`.
   * pose: { recoil, hammerAngle, blinking } from Player.pose().
   */
  drawPlayer(context, view, position, direction, weaponName, pose) {
    const weapon = this.weapons[weaponName];
    const aimAngle = Math.atan2(direction.y, direction.x);
    const facingLeft = direction.x < 0;

    // The weapon is drawn behind the tee.
    if (weaponName === 'hammer') {
      const x = facingLeft ? position.x - weapon.offsetX : position.x;
      const y = position.y + weapon.offsetY;
      const swing = pose.hammerAngle * Math.PI * 2;
      const rotation = facingLeft ? -Math.PI / 2 - swing : -Math.PI / 2 + swing;
      this.drawSprite(context, view, weapon.image, x, y, weapon.width, weapon.height, rotation, false, facingLeft);
    } else {
      const reach = weapon.offsetX - pose.recoil * 10;
      const x = position.x + direction.x * reach;
      const y = position.y + direction.y * reach + weapon.offsetY;
      this.drawSprite(context, view, weapon.image, x, y, weapon.width, weapon.height, aimAngle, false, facingLeft);
    }

    // RenderTee6: outlines first, then the body, the eyes and the feet.
    const size = 64;
    const body = { x: position.x, y: position.y - 4 };
    const backFoot = { x: position.x - 7, y: position.y + 10 };
    const frontFoot = { x: position.x + 7, y: position.y + 10 };
    for (const outline of [true, false]) {
      const foot = outline ? this.footOutline : this.foot;
      this.drawSprite(context, view, foot, backFoot.x, backFoot.y, size, size / 2);
      this.drawSprite(context, view, outline ? this.bodyOutline : this.body, body.x, body.y, size, size);
      if (!outline) {
        const eyeSize = size * 0.4;
        const eyeHeight = pose.blinking ? size * 0.15 : eyeSize;
        const eyeSeparation = (0.075 - 0.01 * Math.abs(direction.x)) * size;
        const eyeX = body.x + direction.x * 0.125 * size;
        const eyeY = body.y + (-0.05 + direction.y * 0.1) * size;
        this.drawSprite(context, view, this.eye, eyeX - eyeSeparation, eyeY, eyeSize, eyeHeight);
        this.drawSprite(context, view, this.eye, eyeX + eyeSeparation, eyeY, eyeSize, eyeHeight, 0, true);
      }
      this.drawSprite(context, view, foot, frontFoot.x, frontFoot.y, size, size / 2);
    }
  }

  /** CPlayers::RenderHook(): hook head at `hookPosition`, chain links every 24 units back to the tee, then the hand. */
  drawHook(context, view, position, hookPosition) {
    const distance = Math.hypot(position.x - hookPosition.x, position.y - hookPosition.y);
    if (distance === 0) return;
    const back = { x: (position.x - hookPosition.x) / distance, y: (position.y - hookPosition.y) / distance };
    const rotation = Math.atan2(back.y, back.x) + Math.PI;
    this.drawSprite(context, view, this.hookHead, hookPosition.x, hookPosition.y, HOOK_SIZE.width, HOOK_SIZE.height, rotation);
    for (let step = 24; step < distance; step += 24) {
      const x = hookPosition.x + back.x * step;
      const y = hookPosition.y + back.y * step;
      this.drawSprite(context, view, this.hookChain, x, y, HOOK_SIZE.width, HOOK_SIZE.height, rotation);
    }

    // RenderHand(): angle offset −π/2, then 20 units along the hook direction
    const toward = { x: -back.x, y: -back.y };
    const aim = Math.atan2(toward.y, toward.x);
    const handRotation = toward.x < 0 ? aim + Math.PI / 2 : aim - Math.PI / 2;
    const handX = position.x + toward.x + toward.x * 20;
    const handY = position.y + toward.y + toward.y * 20;
    this.drawSprite(context, view, this.handOutline, handX, handY, HAND_SIZE, HAND_SIZE, handRotation);
    this.drawSprite(context, view, this.hand, handX, handY, HAND_SIZE, HAND_SIZE, handRotation);
  }

  /**
   * CItems::RenderLaser for a rifle laser: a body from `from` to `to`, `width` from 1 (just fired) to 0,
   * and a rotating splat at the end. `ticks` is the current game time in ticks.
   */
  drawLaser(context, view, from, to, width, ticks) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0 && width > 0) {
      const direction = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
      const toCanvas = (x, y) => [view.originX + x * view.scale, view.originY + y * view.scale];
      const drawQuad = (halfWidth, inset, rgb) => {
        const normalX = direction.y * halfWidth;
        const normalY = -direction.x * halfWidth;
        const insetX = direction.x * inset;
        const insetY = direction.y * inset;
        context.beginPath();
        context.moveTo(...toCanvas(from.x - normalX + insetX, from.y - normalY + insetY));
        context.lineTo(...toCanvas(from.x + normalX + insetX, from.y + normalY + insetY));
        context.lineTo(...toCanvas(to.x + normalX - insetX, to.y + normalY - insetY));
        context.lineTo(...toCanvas(to.x - normalX - insetX, to.y - normalY - insetY));
        context.closePath();
        context.fillStyle = cssColor(rgb);
        context.fill();
      };
      drawQuad(7 * width, 0, this.laserOutline);
      drawQuad(5 * width, 1, this.laserInner);
    }

    const tick = Math.trunc(ticks);
    const splat = tick % 3;
    this.drawSprite(context, view, this.splatsOutline[splat], to.x, to.y, 24, 24, tick);
    this.drawSprite(context, view, this.splatsInner[splat], to.x, to.y, 20, 20, tick);
  }

  /**
   * The cursor is part of the HUD: it is drawn at zoom 1 around the screen center.
   * `center` is in canvas pixels, `offset` in units, `scale` in pixels per unit.
   */
  drawCursor(context, center, offset, scale, weaponName) {
    const weapon = this.weapons[weaponName];
    const size = weapon.cursorSize * scale;
    context.drawImage(weapon.cursor, center.x + offset.x * scale - size / 2, center.y + offset.y * scale - size / 2, size, size);
  }
}
