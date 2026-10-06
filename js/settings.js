/**
 * The console variables the editor works with.
 * Ranges and defaults come from DDNet's src/engine/shared/config_variables.h.
 *
 * group       'dyncam' (cl_dyncam 1), 'mouse' (cl_dyncam 0) or 'preview' (only used by the preview)
 * advanced    shown under "More settings"
 * sliderMax   end of the slider when the game range is much larger than useful values
 * ringColor   CSS variable of the circle drawn for this setting in the game view
 * note        extra text for the tooltip
 */
export const SETTINGS = [
  {
    name: 'cl_dyncam_max_distance',
    group: 'dyncam',
    min: 0,
    max: 2000,
    defaultValue: 1000,
    ringColor: '--ring-dyncam-max',
    description: 'Maximum dynamic camera cursor distance',
    note: 'Effective limit: 200 × 100 / cl_dyncam_follow_factor + cl_dyncam_deadzone.',
  },
  {
    name: 'cl_dyncam_deadzone',
    group: 'dyncam',
    min: 1,
    max: 1300,
    defaultValue: 300,
    ringColor: '--ring-deadzone',
    description: 'Deadzone for the dynamic camera to follow the cursor',
  },
  {
    name: 'cl_dyncam_follow_factor',
    group: 'dyncam',
    min: 0,
    max: 200,
    defaultValue: 60,
    ringColor: '--ring-camera-offset',
    description: 'Factor for the dynamic camera to follow the cursor',
  },
  {
    name: 'cl_dyncam_min_distance',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 2000,
    defaultValue: 0,
    ringColor: '--ring-dyncam-min',
    description: 'Minimum dynamic camera cursor distance',
  },
  {
    name: 'cl_dyncam_smoothness',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100,
    defaultValue: 0,
    description: 'Transition amount of the camera movement, 0=instant, 100=slow and smooth',
  },
  {
    name: 'cl_dyncam_stabilizing',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100,
    defaultValue: 0,
    description: 'Amount of camera slowdown during fast cursor movement. High value can cause delay in camera movement',
    note: 'Only with cl_dyncam_smoothness above 0.',
  },
  {
    name: 'cl_dyncam_mousesens',
    group: 'dyncam',
    advanced: true,
    min: 0,
    max: 100000,
    sliderMax: 1000,
    defaultValue: 0,
    description: 'Mouse sens used when dyncam is toggled on',
    note: '0: inp_mousesens is used. Felt in the preview with Capture mouse.',
  },
  {
    name: 'cl_mouse_max_distance',
    group: 'mouse',
    min: 0,
    max: 5000,
    sliderMax: 2000,
    defaultValue: 400,
    ringColor: '--ring-mouse-max',
    description: 'Maximum cursor distance',
    note: 'With cl_mouse_followfactor above 0, same limit as the dyncam: 200 × 100 / cl_mouse_followfactor + cl_mouse_deadzone.',
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
    description: 'Minimum cursor distance',
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
    description: 'Deadzone for the camera to follow the cursor',
  },
  {
    name: 'cl_mouse_followfactor',
    group: 'mouse',
    advanced: true,
    min: 0,
    max: 200,
    defaultValue: 0,
    ringColor: '--ring-camera-offset',
    description: 'Factor for the camera to follow the cursor',
  },
  {
    name: 'inp_mousesens',
    group: 'preview',
    min: 1,
    max: 100000,
    sliderMax: 1000,
    defaultValue: 200,
    description: 'Mouse sensitivity',
    note: 'Your usual sensitivity. Only used by the preview with Capture mouse, not written in the commands.',
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
