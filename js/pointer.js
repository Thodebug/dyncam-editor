import { clampMousePosition, cursorFromMouse, cursorLimits } from './camera.js';

/** Scrolling, in pixels, that counts as one wheel notch. Browsers report about 100 per notch of a mouse wheel. */
const WHEEL_NOTCH = 50;

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
  /** getScreen() returns the visible world size at zoom 1: { width, height }. */
  constructor({ canvas, stage, store, player, getScreen, onChange }) {
    this.canvas = canvas;
    this.stage = stage;
    this.store = store;
    this.player = player;
    this.getScreen = getScreen;
    this.onChange = onChange;

    /** Mouse position relative to the tee in units, or null before the first move. */
    this.mouse = null;
    this.fireHeld = false;
    this.hookHeld = false;
    this.captureEnabled = false;
    this.captured = false;
    /** Wheel movement not yet turned into a weapon switch, in pixels */
    this.wheelDelta = 0;

    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
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

  cursorPosition() {
    return cursorFromMouse(this.mouse, this.limits()).position;
  }

  /** Text shown over the game view, or '' for none. */
  hint() {
    if (this.captureEnabled && !this.captured) return 'Click to capture the mouse · Esc to release';
    if (this.mouse) return '';
    return matchMedia('(pointer: coarse)').matches
      ? 'Drag on the screen to aim'
      : 'Move the mouse over the screen to aim';
  }

  setCaptureEnabled(enabled) {
    this.captureEnabled = enabled;
    if (!enabled && this.captured) document.exitPointerLock();
    this.onChange();
  }

  /** Sets the mouse position and tells the player its aim may have changed. */
  setMouse(mouse) {
    this.mouse = mouse;
    this.player.aimAt(performance.now(), this.cursorPosition());
    this.onChange();
  }

  /** Hover aiming: the offset from the screen center, in units at zoom 1. */
  aimAt(event) {
    if (this.captured) return;
    const box = this.canvas.getBoundingClientRect();
    const screen = this.getScreen();
    const unitsPerPixel = screen.width / box.width;
    const gain = Math.max(1, this.limits().effectiveMax / ((0.95 * screen.height) / 2));
    this.setMouse({
      x: (event.clientX - box.left - box.width / 2) * unitsPerPixel * gain,
      y: (event.clientY - box.top - box.height / 2) * unitsPerPixel * gain,
    });
  }

  onPointerDown(event) {
    if (this.captureEnabled && !this.captured && event.pointerType === 'mouse' && event.button === 0) {
      event.preventDefault();
      this.capture();
      return;
    }
    this.aimAt(event);
    if (event.pointerType === 'touch') return;
    if (event.button !== 0 && event.button !== 2) return;

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone.
    }
    event.preventDefault();
    this.updateButtons(event.buttons);
  }

  onPointerMove(event) {
    this.aimAt(event);
    // The click that captures the mouse does not fire.
    if (event.pointerType === 'touch' || (this.captureEnabled && !this.captured)) return;
    this.updateButtons(event.buttons);
  }

  onPointerUp(event) {
    this.updateButtons(event.buttons);
  }

  /**
   * Fire (left button) and hook (right button) follow the buttons held, given as PointerEvent.buttons.
   * A second button pressed or released while the other one is held only shows in pointermove events.
   */
  updateButtons(buttons) {
    const fire = (buttons & 1) !== 0;
    const hook = (buttons & 2) !== 0;
    if (fire === this.fireHeld && hook === this.hookHeld) return;
    const now = performance.now();
    if (fire && !this.fireHeld) {
      this.fireHeld = true;
      this.player.pressFire(now, this.cursorPosition());
    } else if (!fire) {
      this.releaseFire();
    }
    if (hook && !this.hookHeld) {
      this.hookHeld = true;
      this.player.pressHook(now, this.cursorPosition());
    } else if (!hook) {
      this.releaseHook();
    }
    this.onChange();
  }

  releaseFire() {
    if (!this.fireHeld) return;
    this.fireHeld = false;
    this.player.releaseFire(performance.now());
  }

  releaseHook() {
    if (!this.hookHeld) return;
    this.hookHeld = false;
    this.player.releaseHook(performance.now());
  }

  releaseButtons() {
    this.releaseFire();
    this.releaseHook();
    this.onChange();
  }

  /** One weapon switch per wheel notch: scrolling is added up and switches every WHEEL_NOTCH pixels. */
  onWheel(event) {
    event.preventDefault();
    let pixelsPerUnit = 1;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) pixelsPerUnit = 33;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) pixelsPerUnit = 800;
    // Changing direction starts again from zero
    if (Math.sign(event.deltaY) !== Math.sign(this.wheelDelta)) this.wheelDelta = 0;
    this.wheelDelta += event.deltaY * pixelsPerUnit;
    if (Math.abs(this.wheelDelta) < WHEEL_NOTCH) return;
    this.wheelDelta = 0;
    this.player.switchWeapon(performance.now());
    this.onChange();
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
    if (!this.captured) this.releaseButtons();
    this.onChange();
  }

  /** CControls::OnCursorMove(): mouse += movement × sensitivity / 100, then ClampMousePos(). */
  onCapturedMove(event) {
    if (!this.captured) return;
    const values = this.store.values;
    const sensitivity =
      this.store.dyncam && values.cl_dyncam_mousesens ? values.cl_dyncam_mousesens : values.inp_mousesens;
    const limits = this.limits();
    const mouse = this.mouse ?? { x: limits.effectiveMax, y: 0 };
    this.setMouse(
      clampMousePosition(
        { x: mouse.x + (event.movementX * sensitivity) / 100, y: mouse.y + (event.movementY * sensitivity) / 100 },
        limits,
      ),
    );
  }
}
