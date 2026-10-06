import { clampMousePosition, cursorFromMouse, cursorLimits } from './camera.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './game-view.js';

/**
 * Mouse input on the game view, with DDNet's default binds:
 * left button fires, right button hooks, the wheel switches between laser and hammer.
 *
 * Two ways to aim:
 * - hover: the cursor follows the system pointer. When the cursor can go further than the screen edge,
 *   the movement is amplified so the whole range stays reachable.
 * - capture: the pointer is locked and raw mouse movement is applied with the game's sensitivity
 *   (CControls::OnCursorMove).
 */
export class PointerInput {
  constructor({ canvas, stage, store, laserGun, onChange }) {
    this.canvas = canvas;
    this.stage = stage;
    this.store = store;
    this.laserGun = laserGun;
    this.onChange = onChange;

    /** Mouse position relative to the tee in units, or null before the first move. */
    this.mouse = null;
    this.weapon = 'laser';
    this.fireHeld = false;
    this.hookHeld = false;
    this.captureEnabled = false;
    this.captured = false;

    canvas.addEventListener('pointermove', (event) => this.aimAt(event));
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('lostpointercapture', () => this.releaseButtons());
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    document.addEventListener('mousemove', (event) => this.onCapturedMove(event));
  }

  limits() {
    return cursorLimits(this.store.values, this.store.dyncam);
  }

  /** Text shown over the game view, or '' for none. */
  hint() {
    if (this.captureEnabled && !this.captured) return 'Click to capture the mouse · Esc to release';
    if (this.mouse) return '';
    return matchMedia('(pointer: coarse)').matches ? 'Drag on the screen to aim' : 'Move the mouse over the screen to aim';
  }

  setCaptureEnabled(enabled) {
    this.captureEnabled = enabled;
    if (!enabled && this.captured) document.exitPointerLock();
    this.onChange();
  }

  /** Hover aiming: the offset from the screen center, in units at zoom 1. */
  aimAt(event) {
    if (this.captured) return;
    const box = this.canvas.getBoundingClientRect();
    const unitsPerPixel = SCREEN_WIDTH / box.width;
    const gain = Math.max(1, this.limits().effectiveMax / ((0.95 * SCREEN_HEIGHT) / 2));
    this.mouse = {
      x: (event.clientX - box.left - box.width / 2) * unitsPerPixel * gain,
      y: (event.clientY - box.top - box.height / 2) * unitsPerPixel * gain,
    };
    this.onChange();
  }

  onPointerDown(event) {
    if (this.captureEnabled && !this.captured && event.pointerType === 'mouse' && event.button === 0) {
      event.preventDefault();
      this.capture();
      return;
    }
    this.aimAt(event);
    if (event.pointerType === 'touch') return;

    if (event.button === 0) {
      this.fireHeld = true;
      this.updateTrigger();
      // Fire now: a short click can end before the next frame.
      this.laserGun.update(performance.now(), this.cursorPosition());
    } else if (event.button === 2) {
      this.hookHeld = true;
    } else {
      return;
    }
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone.
    }
    event.preventDefault();
    this.onChange();
  }

  onPointerUp(event) {
    if (event.button === 0) this.fireHeld = false;
    if (event.button === 2) this.hookHeld = false;
    this.updateTrigger();
    this.onChange();
  }

  releaseButtons() {
    this.fireHeld = false;
    this.hookHeld = false;
    this.updateTrigger();
    this.onChange();
  }

  onWheel(event) {
    event.preventDefault();
    if (Math.abs(event.deltaY) < 1) return;
    this.weapon = this.weapon === 'laser' ? 'hammer' : 'laser';
    this.updateTrigger();
    this.onChange();
  }

  /** The laser fires only while the laser is the active weapon. */
  updateTrigger() {
    this.laserGun.triggerHeld = this.fireHeld && this.weapon === 'laser';
  }

  cursorPosition() {
    return cursorFromMouse(this.mouse, this.limits()).position;
  }

  /* ---------- Captured mouse ---------- */

  capture() {
    try {
      const request = this.canvas.requestPointerLock({ unadjustedMovement: true });
      request?.catch?.(() => this.requestPlainPointerLock());
    } catch {
      this.requestPlainPointerLock();
    }
  }

  /** Fallback for browsers without raw mouse input. */
  requestPlainPointerLock() {
    try {
      this.canvas.requestPointerLock();
    } catch {
      // Pointer lock is not available.
    }
  }

  onPointerLockChange() {
    this.captured = document.pointerLockElement === this.canvas;
    this.stage.classList.toggle('is-mouse-captured', this.captured);
    if (!this.captured) {
      this.fireHeld = false;
      this.hookHeld = false;
      this.updateTrigger();
    }
    this.onChange();
  }

  /** CControls::OnCursorMove(): mouse += movement × sensitivity / 100, then ClampMousePos(). */
  onCapturedMove(event) {
    if (!this.captured) return;
    const values = this.store.values;
    const sensitivity = this.store.dyncam && values.cl_dyncam_mousesens ? values.cl_dyncam_mousesens : values.inp_mousesens;
    const limits = this.limits();
    const mouse = this.mouse ?? { x: limits.effectiveMax, y: 0 };
    this.mouse = clampMousePosition(
      { x: mouse.x + (event.movementX * sensitivity) / 100, y: mouse.y + (event.movementY * sensitivity) / 100 },
      limits,
    );
    this.onChange();
  }
}
