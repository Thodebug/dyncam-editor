import { f32, normalizeVector, vectorLength } from './collision.js';

/**
 * Laser of a classic fng server: fng2 tuning, or ddnet-insta with its recommended reset.cfg.
 * The laser never hits its own tee (vanilla behavior, sv_old_laser 1 on DDNet servers).
 */
export const LASER = {
  reach: 800, // laser_reach
  bounceCount: 1, // laser_bounce_num
  bounceDelayMs: 150, // laser_bounce_delay
  bounceCost: 0, // laser_bounce_cost
  fireDelayTicks: 40, // 800 ms between shots while the fire button is held
};

export const TICK_MS = 20; // 50 server ticks per second

/** A segment is shown until the next CLaser::DoBounce(), which runs once more than 7.5 ticks have passed. */
const SEGMENT_TICKS = Math.floor((LASER.bounceDelayMs * 50) / 1000) + 1;

/** Fire direction: the input target is the mouse position cast to integers, then normalized by the server. */
export function aimDirection(cursorPosition) {
  let x = Math.trunc(cursorPosition.x);
  const y = Math.trunc(cursorPosition.y);
  if (x === 0 && y === 0) x = 1;
  return normalizeVector({ x, y });
}

/**
 * Path of one shot, following CLaser::DoBounce().
 * Returns the segments in order: [{ from, to }].
 */
export function traceLaser(collision, origin, direction) {
  const segments = [];
  let position = { x: f32(origin.x), y: f32(origin.y) };
  let heading = direction;
  let energy = f32(LASER.reach);
  let bounces = 0;
  let previousBounceWasZeroLength = false;

  while (energy >= 0 && segments.length < 64) {
    const target = {
      x: f32(position.x + f32(heading.x * energy)),
      y: f32(position.y + f32(heading.y * energy)),
    };
    const hitPoint = collision.intersectLine(position, target);

    if (!hitPoint) {
      segments.push({ from: position, to: target });
      break;
    }

    // Bounce: step back out of the wall, then reflect the direction.
    const from = position;
    const bouncePosition = { ...hitPoint };
    const bounceVelocity = { x: f32(heading.x * 4), y: f32(heading.y * 4) };
    collision.movePoint(bouncePosition, bounceVelocity);
    position = bouncePosition;
    heading = normalizeVector(bounceVelocity);

    const distance = vectorLength(f32(from.x - position.x), f32(from.y - position.y));
    if (distance === 0 && previousBounceWasZeroLength) energy = -1;
    else energy = f32(energy - f32(distance + LASER.bounceCost));
    previousBounceWasZeroLength = distance === 0;

    bounces++;
    if (bounces > LASER.bounceCount) energy = -1;

    segments.push({ from, to: { ...position } });
  }
  return segments;
}

/**
 * Fires lasers while the trigger is held and tells which segments are visible at a given time.
 * Times are in ms (performance.now()).
 */
export class LaserGun {
  constructor(collision, origin) {
    this.collision = collision;
    this.origin = origin;
    this.triggerHeld = false;
    this.shots = [];
    this.nextFireTick = 0;
  }

  /** Fires if the trigger is held and the weapon has reloaded. */
  update(now, cursorPosition) {
    const tick = Math.floor(now / TICK_MS);
    if (!this.triggerHeld || tick < this.nextFireTick) return;
    const segments = traceLaser(this.collision, this.origin, aimDirection(cursorPosition));
    this.shots.push({ tick, segments });
    this.nextFireTick = tick + LASER.fireDelayTicks;
  }

  /**
   * Segments to draw at `now`: [{ from, to, width }].
   * width goes from 1 to 0 over laser_bounce_delay, like CItems::RenderLaser().
   */
  visibleSegments(now) {
    const tick = now / TICK_MS;
    this.shots = this.shots.filter((shot) => tick < shot.tick + SEGMENT_TICKS * shot.segments.length);

    const visible = [];
    for (const shot of this.shots) {
      const index = Math.floor((tick - shot.tick) / SEGMENT_TICKS);
      const segment = shot.segments[index];
      if (!segment) continue;
      const ageMs = (tick - (shot.tick + index * SEGMENT_TICKS)) * TICK_MS;
      const width = 1 - Math.min(Math.max(ageMs / LASER.bounceDelayMs, 0), 1);
      visible.push({ ...segment, width });
    }
    return visible;
  }

  isActive() {
    return this.triggerHeld || this.shots.length > 0;
  }
}
