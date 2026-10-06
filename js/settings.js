/**
 * The console variables the editor works with.
 * Ranges and defaults come from DDNet's src/engine/shared/config_variables.h.
 *
 * group       'dyncam' (cl_dyncam 1), 'mouse' (cl_dyncam 0) or 'preview' (only used by the preview)
 * advanced    shown under "More settings"
 * sliderMax   end of the slider when the game range is much larger than useful values
 * ringColor   CSS variable of the circle drawn for this setting in the game view
 * tip         tooltip text (**bold**, line breaks kept); settings-panel.js adds live details and the range
 */
export const SETTINGS = [
  {
    name: 'cl_dyncam_max_distance',
    group: 'dyncam',
    min: 0,
    max: 2000,
    defaultValue: 1000,
    ringColor: '--ring-dyncam-max',
    tip: 'How far your cursor can go from your tee.',
  },
  {
    name: 'cl_dyncam_deadzone',
    group: 'dyncam',
    min: 1,
    max: 1300,
    defaultValue: 300,
    ringColor: '--ring-deadzone',
    tip: 'Cursor distance at which the camera starts to follow.\nCloser than that, the camera stays on your tee.',
  },
  {
    name: 'cl_dyncam_follow_factor',
    group: 'dyncam',
    min: 0,
    max: 200,
    defaultValue: 60,
    ringColor: '--ring-camera-offset',
    tip: 'Share of the cursor movement past the deadzone that the camera follows, in %.\n100 = the camera moves as much as the cursor,\n0 = it stays on your tee.\nThe camera never moves more than **200**.',
  },
  {
    name: 'cl_dyncam_min_distance',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 2000,
    defaultValue: 0,
    ringColor: '--ring-dyncam-min',
    tip: 'Minimum cursor distance.\n0 = no minimum.',
  },
  {
    name: 'cl_dyncam_smoothness',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100,
    defaultValue: 0,
    tip: 'How smoothly the camera glides to its new position.\n0 = instant, 100 = slow and smooth.',
  },
  {
    name: 'cl_dyncam_stabilizing',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100,
    defaultValue: 0,
    tip: 'Slows the camera during fast cursor moves.',
  },
  {
    name: 'cl_dyncam_mousesens',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100000,
    sliderMax: 1000,
    defaultValue: 0,
    tip: 'Mouse sensitivity with cl_dyncam 1.\n0 = use inp_mousesens.\nFelt in the preview with **Capture mouse**.',
  },
  {
    name: 'cl_mouse_max_distance',
    group: 'mouse',
    min: 0,
    max: 5000,
    sliderMax: 2000,
    defaultValue: 400,
    ringColor: '--ring-mouse-max',
    tip: 'How far your cursor can go from your tee.',
  },
  {
    name: 'cl_mouse_min_distance',
    group: 'mouse',
    advanced: true,
    min: 0,
    max: 5000,
    sliderMax: 2000,
    defaultValue: 0,
    ringColor: '--ring-mouse-min',
    tip: 'Minimum cursor distance.\n0 = no minimum.',
  },
  {
    name: 'cl_mouse_deadzone',
    group: 'mouse',
    advanced: true,
    min: 0,
    max: 3000,
    sliderMax: 2000,
    defaultValue: 0,
    ringColor: '--ring-deadzone',
    tip: 'Cursor distance at which the camera starts to follow.\nCloser than that, the camera stays on your tee.',
  },
  {
    name: 'cl_mouse_followfactor',
    group: 'mouse',
    advanced: true,
    min: 0,
    max: 200,
    defaultValue: 0,
    ringColor: '--ring-camera-offset',
    tip: 'Share of the cursor movement past the deadzone that the camera follows, in %.\n100 = the camera moves as much as the cursor,\n0 = it stays on your tee.\nThe camera never moves more than **200**.',
  },
  {
    name: 'inp_mousesens',
    group: 'preview',
    min: 1,
    max: 100000,
    sliderMax: 1000,
    defaultValue: 200,
    tip: 'Your usual mouse sensitivity.\nOnly for the preview with **Capture mouse**, not added to the commands.',
  },
];

export const SETTINGS_BY_NAME = Object.fromEntries(SETTINGS.map((setting) => [setting.name, setting]));

/** Camera settings, in the order used by share links. */
export const CAMERA_SETTINGS = SETTINGS.filter((setting) => setting.group !== 'preview');

/** Lines written in the commands list, in this order. */
export const COMMAND_NAMES = [
  'cl_dyncam',
  ...SETTINGS.filter((setting) => setting.group === 'mouse').map((setting) => setting.name),
  ...SETTINGS.filter((setting) => setting.group === 'dyncam').map((setting) => setting.name),
];

/** DDNet default of cl_dyncam. */
export const DEFAULT_DYNCAM = 0;

/** Clamps a value to the range accepted by the game. */
export function clampToRange(setting, value) {
  if (!Number.isFinite(value)) return setting.defaultValue;
  return Math.round(Math.min(setting.max, Math.max(setting.min, value)));
}

export function defaultValues() {
  return Object.fromEntries(SETTINGS.map((setting) => [setting.name, setting.defaultValue]));
}
