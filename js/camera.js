/**
 * Cursor and camera math of the DDNet client
 * (src/game/client/components/controls.cpp and camera.cpp).
 * Distances are in world units (1 tile = 32 units).
 */

/** CameraMaxDistance in CControls::GetMaxMouseDistance(): the largest camera offset. */
export const CAMERA_MAX_DISTANCE = 200;

/** Cursor and camera settings of the active camera mode. */
export function cursorLimits(values, dyncam) {
  const limits = dyncam
    ? {
        maxDistance: values.cl_dyncam_max_distance,
        minDistance: values.cl_dyncam_min_distance,
        deadzone: values.cl_dyncam_deadzone,
        followFactor: values.cl_dyncam_follow_factor,
      }
    : {
        maxDistance: values.cl_mouse_max_distance,
        minDistance: values.cl_mouse_min_distance,
        deadzone: values.cl_mouse_deadzone,
        followFactor: values.cl_mouse_followfactor,
      };

  // CControls::GetMaxMouseDistance()
  const factor = limits.followFactor / 100;
  limits.effectiveMax =
    factor > 0 ? Math.min(CAMERA_MAX_DISTANCE / factor + limits.deadzone, limits.maxDistance) : limits.maxDistance;
  return limits;
}

/** CControls::ClampMousePos(): the minimum distance is applied first, then the maximum. */
export function clampCursorDistance(distance, limits) {
  return Math.min(Math.max(distance, Math.min(limits.minDistance, limits.effectiveMax)), limits.effectiveMax);
}

/** Same as clampCursorDistance(), on a mouse vector. Returns a new vector. */
export function clampMousePosition(mouse, limits) {
  let { x, y } = mouse;
  let distance = Math.hypot(x, y);
  if (distance < 0.001) {
    x = 0.001;
    y = 0;
    distance = 0.001;
  }
  if (distance < limits.minDistance) {
    x *= limits.minDistance / distance;
    y *= limits.minDistance / distance;
    distance = Math.hypot(x, y);
  }
  if (distance > limits.effectiveMax) {
    x *= limits.effectiveMax / distance;
    y *= limits.effectiveMax / distance;
  }
  return { x, y };
}

/** Camera offset for a cursor at this distance (CCamera::OnUpdate). */
export function cameraOffsetAt(distance, limits) {
  return (Math.max(distance - limits.deadzone, 0) * limits.followFactor) / 100;
}

/**
 * Cursor position for a mouse vector (relative to the tee).
 * Without a mouse position yet, the cursor rests to the right at the maximum distance.
 */
export function cursorFromMouse(mouse, limits) {
  let direction = { x: 1, y: 0 };
  let distance = limits.effectiveMax;
  if (mouse) {
    const length = Math.hypot(mouse.x, mouse.y);
    if (length > 1e-3) direction = { x: mouse.x / length, y: mouse.y / length };
    distance = length;
  }
  distance = clampCursorDistance(distance, limits);
  return {
    direction,
    distance,
    position: { x: direction.x * distance, y: direction.y * distance },
    cameraOffset: cameraOffsetAt(distance, limits),
  };
}

/**
 * Camera smoothing of CCamera::OnUpdate() (cl_dyncam_smoothness and cl_dyncam_stabilizing).
 * The camera offset moves toward its target a little more each frame.
 */
export class CameraSmoothing {
  constructor() {
    this.offset = { x: 0, y: 0 };
    this.speedBias = 0.5;
    this.lastCursor = null;
    this.lastTime = 0;
  }

  /**
   * Advances the camera to `now` (ms) and returns true while it is still moving.
   * cursor: cursor position, target: camera offset the camera moves toward.
   */
  update(cursor, target, { smoothness, stabilizing, dyncam }, now) {
    const elapsed = this.lastTime ? (now - this.lastTime) / 1000 : 1;
    this.lastTime = now;
    // After an idle pause, move as if one normal frame had passed.
    const frameTime = elapsed > 0.1 ? 1 / 60 : elapsed;

    if (smoothness > 0) {
      const cameraSpeed = (1 - smoothness / 100) * 9.5 + 0.5;
      const stabilizingFactor = 1 + stabilizing / 100;
      this.speedBias += cameraSpeed * elapsed;
      if (dyncam) {
        const cursorMove = this.lastCursor ? Math.hypot(cursor.x - this.lastCursor.x, cursor.y - this.lastCursor.y) : 0;
        this.speedBias -= cursorMove * Math.log10(stabilizingFactor) * 0.02;
        this.speedBias = Math.min(Math.max(this.speedBias, 0.5), cameraSpeed);
      } else {
        this.speedBias = Math.max(5, cameraSpeed);
      }
      const step = Math.min(frameTime * this.speedBias, 1);
      this.offset.x += (target.x - this.offset.x) * step;
      this.offset.y += (target.y - this.offset.y) * step;
    } else {
      this.offset = { ...target };
    }

    this.lastCursor = { ...cursor };
    return Math.hypot(target.x - this.offset.x, target.y - this.offset.y) > 0.05;
  }
}
