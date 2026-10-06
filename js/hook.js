import { TILE_NOHOOK, f32, normalizeVector, roundToInt, vectorLength } from './collision.js';

/** Hook tuning and CCharacterCore constants (src/game/tuning.h, gamecore.cpp). */
const HOOK_LENGTH = 380; // hook_length
const HOOK_FIRE_SPEED = 80; // hook_fire_speed
const PHYSICAL_SIZE = 28;

/** Hook states of CCharacterCore (src/game/gamecore.h). */
const HOOK_RETRACTED = -1;
const HOOK_IDLE = 0;
const HOOK_RETRACT_START = 1;
const HOOK_RETRACT_END = 3;
const HOOK_FLYING = 4;
const HOOK_GRABBED = 5;

/**
 * Hook of a tee that does not move, tick by tick as in CCharacterCore::Tick():
 * it flies 80 units per tick, grabs solid ground, or retracts on unhookable tiles and at full length.
 * Once grabbed, the game pulls the tee toward the hook; here the tee stays in place.
 */
export class Hook {
  constructor(collision, origin) {
    this.collision = collision;
    this.origin = origin;
    this.launchTick = null;
    this.releaseTick = null;
    this.states = [];
  }

  /** Hook button pressed at `tick`, toward `direction` (normalized input target). */
  press(tick, direction) {
    this.launchTick = tick;
    this.releaseTick = null;
    this.states = this.simulate(direction);
  }

  /** Hook button released: the hook is gone from the next tick on. */
  release(tick) {
    if (this.launchTick !== null && this.releaseTick === null) this.releaseTick = tick;
  }

  /** States after each tick from the launch tick, until the hook is grabbed or retracted. */
  simulate(direction) {
    const position = { x: f32(this.origin.x), y: f32(this.origin.y) };
    let hookPosition = {
      x: f32(position.x + f32(direction.x * f32(PHYSICAL_SIZE * 1.5))),
      y: f32(position.y + f32(direction.y * f32(PHYSICAL_SIZE * 1.5))),
    };
    let state = HOOK_FLYING;
    const states = [];

    while (states.length < 100) {
      if (state >= HOOK_RETRACT_START && state < HOOK_RETRACT_END) {
        state++;
      } else if (state === HOOK_RETRACT_END) {
        state = HOOK_RETRACTED;
      } else if (state === HOOK_FLYING) {
        let target = {
          x: f32(hookPosition.x + f32(direction.x * HOOK_FIRE_SPEED)),
          y: f32(hookPosition.y + f32(direction.y * HOOK_FIRE_SPEED)),
        };
        if (vectorLength(f32(position.x - target.x), f32(position.y - target.y)) > HOOK_LENGTH) {
          state = HOOK_RETRACT_START;
          const away = normalizeVector({ x: f32(target.x - position.x), y: f32(target.y - position.y) });
          target = { x: f32(position.x + f32(away.x * HOOK_LENGTH)), y: f32(position.y + f32(away.y * HOOK_LENGTH)) };
        }
        const hit = this.collision.intersectLine(hookPosition, target);
        if (hit) target = hit.point;

        // The position only moves while the hook is still flying after the length check.
        if (state === HOOK_FLYING) {
          if (hit) state = hit.tile === TILE_NOHOOK ? HOOK_RETRACT_START : HOOK_GRABBED;
          hookPosition = target;
        }
      }

      states.push({ state, position: { x: roundToInt(hookPosition.x), y: roundToInt(hookPosition.y) } });
      if (state === HOOK_GRABBED || state === HOOK_RETRACTED) break;
    }
    return states;
  }

  /** State after `tick`: { state, position }. Before launch and after release the hook rests on the tee. */
  stateAt(tick) {
    const resting = { state: HOOK_IDLE, position: this.origin };
    if (this.launchTick === null || tick < this.launchTick) return resting;
    if (this.releaseTick !== null && tick >= this.releaseTick) return resting;
    const index = Math.min(tick - this.launchTick, this.states.length - 1);
    return this.states[index];
  }

  /**
   * Hook head position to draw at `tick` (game time with a fraction), or null when the hook is not drawn.
   * Like CPlayers::RenderHook(): interpolated between the two last ticks, drawn while the state is above 0.
   */
  positionAt(tick) {
    const current = Math.floor(tick);
    const now = this.stateAt(current);
    if (now.state <= HOOK_IDLE) return null;
    const previous = this.stateAt(current - 1);
    const intra = tick - current;
    return {
      x: previous.position.x + (now.position.x - previous.position.x) * intra,
      y: previous.position.y + (now.position.y - previous.position.y) * intra,
    };
  }

  /** True while the drawn hook still changes from frame to frame. */
  isMoving(tick) {
    if (this.launchTick === null) return false;
    const current = Math.floor(tick);
    const same = (a, b) => a.state === b.state && a.position.x === b.position.x && a.position.y === b.position.y;
    const now = this.stateAt(current);
    return !same(this.stateAt(current - 1), now) || !same(now, this.stateAt(current + 1));
  }
}
