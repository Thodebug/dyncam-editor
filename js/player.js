import { normalizeVector } from './collision.js';
import { LaserGun, TICK_MS } from './laser.js';
import { Hook } from './hook.js';

/** Ticks between two hammer hits: firedelay 125 ms (datasrc/content.py) × 50 ticks / 1000. */
const HAMMER_RELOAD_TICKS = Math.floor((125 * 50) / 1000);

/** Duration of the weapon recoil after a shot, and of the hammer swing (0.2 s), in ticks. */
const RECOIL_TICKS = 5;
const HAMMER_SWING_TICKS = 10;

/** The server shows the blink emote 5 s after the last input change, for 4 ticks, then every 5 s. */
const BLINK_PERIOD_TICKS = 250;
const BLINK_TICKS = 5;

/** ANIM_HAMMER_SWING keyframes (datasrc/content.py): [time, attach angle in turns]. */
const HAMMER_SWING = [
  [0.0, -0.1],
  [0.3, 0.25],
  [0.4, 0.3],
  [0.5, 0.25],
  [1.0, -0.1],
];

/** Game time in ticks, with a fraction. */
export function gameTick(now) {
  return now / TICK_MS;
}

/** Fire direction: the input target is the mouse position cast to integers (CControls), then normalized. */
export function aimDirection(cursorPosition) {
  let x = Math.trunc(cursorPosition.x);
  const y = Math.trunc(cursorPosition.y);
  if (x === 0 && y === 0) x = 1;
  return normalizeVector({ x, y });
}

function hammerSwingAngle(progress) {
  for (let i = 1; i < HAMMER_SWING.length; i++) {
    const [endTime, endAngle] = HAMMER_SWING[i];
    if (progress <= endTime) {
      const [startTime, startAngle] = HAMMER_SWING[i - 1];
      return startAngle + ((endAngle - startAngle) * (progress - startTime)) / (endTime - startTime);
    }
  }
  return HAMMER_SWING[HAMMER_SWING.length - 1][1];
}

/**
 * The tee standing on the map: its weapon, laser shots, hook, attack animations and blinking.
 * Ticks are integers; `now` is in ms (performance.now()).
 */
export class Player {
  constructor(collision, position) {
    this.position = position;
    this.weapon = 'laser';
    this.laser = new LaserGun(collision, position);
    this.hook = new Hook(collision, position);
    this.fireHeld = false;
    this.attackTick = -Infinity;
    this.hammerReadyTick = 0;
    this.lastTarget = null;
    this.lastActionTick = Math.floor(gameTick(performance.now()));
  }

  /** Any change of the input (target, buttons, weapon) counts as an action and delays the next blink. */
  noteAction(tick) {
    this.lastActionTick = tick;
  }

  /** The cursor moved: the input target changes when its integer position changes. */
  aimAt(now, cursorPosition) {
    const target = `${Math.trunc(cursorPosition.x)},${Math.trunc(cursorPosition.y)}`;
    if (target === this.lastTarget) return;
    this.lastTarget = target;
    this.noteAction(Math.floor(gameTick(now)));
  }

  pressFire(now, cursorPosition) {
    const tick = Math.floor(gameTick(now));
    this.noteAction(tick);
    this.fireHeld = true;
    if (this.weapon === 'hammer') {
      // The hammer hits once per press, when reloaded.
      if (tick >= this.hammerReadyTick) {
        this.attackTick = tick;
        this.hammerReadyTick = tick + HAMMER_RELOAD_TICKS;
      }
      return;
    }
    this.laser.triggerHeld = true;
    this.update(now, cursorPosition);
  }

  releaseFire(now) {
    this.noteAction(Math.floor(gameTick(now)));
    this.fireHeld = false;
    this.laser.triggerHeld = false;
  }

  pressHook(now, cursorPosition) {
    const tick = Math.floor(gameTick(now));
    this.noteAction(tick);
    this.hook.press(tick, aimDirection(cursorPosition));
  }

  releaseHook(now) {
    const tick = Math.floor(gameTick(now));
    this.noteAction(tick);
    this.hook.release(tick);
  }

  /** Laser and hammer, switched with the mouse wheel. */
  switchWeapon(now) {
    this.noteAction(Math.floor(gameTick(now)));
    this.weapon = this.weapon === 'laser' ? 'hammer' : 'laser';
    this.laser.triggerHeld = this.fireHeld && this.weapon === 'laser';
  }

  /** Fires the laser again while the trigger is held (full auto). */
  update(now, cursorPosition) {
    const tick = Math.floor(gameTick(now));
    if (this.laser.update(tick, aimDirection(cursorPosition))) this.attackTick = tick;
  }

  /**
   * Pose of the tee at `now`, from CPlayers::RenderPlayer():
   * recoil: the laser moves back after a shot (sin over 5 ticks, 10 units at most)
   * hammerAngle: hammer attach angle in turns (ANIM_HAMMER_SWING over 0.2 s)
   * blinking: the server's blink emote
   */
  pose(now) {
    const tick = gameTick(now);
    const ticksSinceAttack = tick - this.attackTick;

    const recoilProgress = ticksSinceAttack / RECOIL_TICKS;
    const recoil = recoilProgress >= 0 && recoilProgress < 1 ? Math.sin(recoilProgress * Math.PI) : 0;

    const swingProgress = Math.min(Math.max(ticksSinceAttack / HAMMER_SWING_TICKS, 0), 1);

    const sinceAction = Math.floor(tick) - this.lastActionTick;
    const blinking = BLINK_PERIOD_TICKS - (sinceAction % BLINK_PERIOD_TICKS) < BLINK_TICKS;

    return { recoil, hammerAngle: hammerSwingAngle(swingProgress), blinking };
  }

  /** True while something moves from frame to frame (shots, hook, attack animations). */
  isAnimating(now) {
    const tick = gameTick(now);
    const ticksSinceAttack = tick - this.attackTick;
    const attackAnimating = ticksSinceAttack < Math.max(RECOIL_TICKS, HAMMER_SWING_TICKS);
    return this.laser.isActive() || this.hook.isMoving(tick) || attackAnimating;
  }

  /** Time in ms until the next blink starts or ends. */
  msUntilBlinkChange(now) {
    const tick = Math.floor(gameTick(now));
    const phase = (tick - this.lastActionTick) % BLINK_PERIOD_TICKS;
    const blinkStart = BLINK_PERIOD_TICKS - BLINK_TICKS + 1;
    const ticksToChange = phase < blinkStart ? blinkStart - phase : BLINK_PERIOD_TICKS - phase;
    return (tick + ticksToChange) * TICK_MS - now;
  }
}
