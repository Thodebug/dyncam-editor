/**
 * Map collision of the DDNet server (src/game/collision.cpp), computed in 32-bit floats
 * like the game so lasers and hooks hit and bounce exactly where they do in game.
 */

const TILE_SIZE = 32;

export const TILE_EMPTY = 0;
export const TILE_SOLID = 1;
export const TILE_NOHOOK = 3;

/** Rounds to a 32-bit float, the precision of the game's `float`. */
export const f32 = Math.fround;

/** round_to_int() from src/base/math.h. */
export function roundToInt(value) {
  return value > 0 ? Math.trunc(f32(value + 0.5)) : Math.trunc(f32(value - 0.5));
}

/** length() of a vec2. */
export function vectorLength(x, y) {
  return f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
}

/** normalize() of a vec2 (src/base/vmath.h). */
export function normalizeVector(vector) {
  const length = vectorLength(vector.x, vector.y);
  if (length === 0) return { x: 0, y: 0 };
  const inverse = f32(1 / length);
  return { x: f32(vector.x * inverse), y: f32(vector.y * inverse) };
}

/** Game layer of a map: TILE_SOLID and TILE_NOHOOK tiles. */
export class CollisionMap {
  constructor(width, height, tiles) {
    this.width = width;
    this.height = height;
    this.tiles = tiles;
  }

  /** Loads an image with one pixel per tile: white = TILE_SOLID, grey = TILE_NOHOOK, black = empty. */
  static async load(url) {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;

    const tiles = new Uint8Array(image.width * image.height);
    for (let i = 0; i < tiles.length; i++) {
      const value = pixels[i * 4];
      tiles[i] = value > 191 ? TILE_SOLID : value > 63 ? TILE_NOHOOK : TILE_EMPTY;
    }
    return new CollisionMap(image.width, image.height, tiles);
  }

  /** CCollision::GetTile() for integer coordinates. Outside the map, the nearest border tile counts. */
  tileAt(x, y) {
    const tileX = Math.min(Math.max(Math.trunc(x / TILE_SIZE), 0), this.width - 1);
    const tileY = Math.min(Math.max(Math.trunc(y / TILE_SIZE), 0), this.height - 1);
    return this.tiles[tileY * this.width + tileX];
  }

  /** CCollision::CheckPoint() */
  checkPoint(x, y) {
    return this.tileAt(roundToInt(x), roundToInt(y)) !== TILE_EMPTY;
  }

  /**
   * Walks from `from` to `to` one unit at a time, like CCollision::IntersectLineTeleWeapon() and
   * IntersectLineTeleHook() on a map without teleporters.
   * Returns { point, before, tile } for the first solid point, or null if the line is free.
   */
  intersectLine(from, to) {
    const distance = vectorLength(f32(from.x - to.x), f32(from.y - to.y));
    const steps = Math.trunc(f32(distance + 1));
    let before = from;
    for (let i = 0; i <= steps; i++) {
      const amount = f32(i / steps);
      const point = {
        x: f32(from.x + f32(f32(to.x - from.x) * amount)),
        y: f32(from.y + f32(f32(to.y - from.y) * amount)),
      };
      const tile = this.tileAt(roundToInt(point.x), roundToInt(point.y));
      if (tile !== TILE_EMPTY) return { point, before, tile };
      before = point;
    }
    return null;
  }

  /**
   * CCollision::MovePoint() with an elasticity of 1: moves `position` by `velocity`,
   * or reflects `velocity` on the wall it would hit. Both objects are modified.
   */
  movePoint(position, velocity) {
    const nextX = f32(position.x + velocity.x);
    const nextY = f32(position.y + velocity.y);
    if (!this.checkPoint(nextX, nextY)) {
      position.x = nextX;
      position.y = nextY;
      return;
    }

    let reflected = 0;
    if (this.checkPoint(nextX, position.y)) {
      velocity.x = -velocity.x;
      reflected++;
    }
    if (this.checkPoint(position.x, nextY)) {
      velocity.y = -velocity.y;
      reflected++;
    }
    if (reflected === 0) {
      velocity.x = -velocity.x;
      velocity.y = -velocity.y;
    }
  }
}
