import {
  SETTINGS,
  SETTINGS_BY_NAME,
  CAMERA_SETTINGS,
  COMMAND_NAMES,
  DEFAULT_DYNCAM,
  clampToRange,
  defaultValues,
} from './settings.js';

const STORAGE_KEY = 'dyncam-editor';
const SAVE_DELAY_MS = 300;

/**
 * Current setting values, the camera mode shown, and the baseline that
 * "changed" values are compared to (the DDNet defaults, or a pasted config).
 * Listeners registered with onChange() run after every modification.
 */
export class ConfigStore {
  constructor() {
    this.values = defaultValues();
    this.dyncam = true;
    this.baseline = ConfigStore.defaultBaseline();
    this.changesOnly = false;
    this.screenFormat = '16:9';
    this.listeners = [];
    this.saveTimer = 0;
  }

  static defaultBaseline() {
    return { ...defaultValues(), cl_dyncam: DEFAULT_DYNCAM };
  }

  onChange(listener) {
    this.listeners.push(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
    this.scheduleSave();
  }

  set(name, value) {
    this.values[name] = clampToRange(SETTINGS_BY_NAME[name], value);
    this.notify();
  }

  setDyncam(enabled) {
    if (this.dyncam === enabled) return;
    this.dyncam = enabled;
    this.notify();
  }

  setChangesOnly(enabled) {
    this.changesOnly = enabled;
    this.notify();
  }

  /** Screen format of the game view. Kept in the browser, not in share links. */
  setScreenFormat(id) {
    this.screenFormat = id;
    this.notify();
  }

  /** Sets every setting like a config file does: listed values are used, the others get their default. */
  replaceValues(values) {
    for (const setting of SETTINGS) {
      const value = setting.name in values ? values[setting.name] : setting.defaultValue;
      this.values[setting.name] = clampToRange(setting, value);
    }
  }

  /** Back to the DDNet defaults. inp_mousesens is the user's own sensitivity and is kept. */
  resetToDefaults() {
    this.replaceValues({ inp_mousesens: this.values.inp_mousesens });
    this.baseline = ConfigStore.defaultBaseline();
    this.notify();
  }

  getState() {
    return { values: { ...this.values }, dyncam: this.dyncam, baseline: { ...this.baseline } };
  }

  setState(state) {
    this.values = { ...state.values };
    this.dyncam = state.dyncam;
    this.baseline = { ...state.baseline };
    this.notify();
  }

  /* ---------- Commands ---------- */

  commandValue(name) {
    if (name === 'cl_dyncam') return this.dyncam ? 1 : 0;
    return this.values[name];
  }

  /** Lines of the commands list: [{ name, value, changed }]. */
  commandLines() {
    const lines = COMMAND_NAMES.map((name) => {
      const value = this.commandValue(name);
      return { name, value, changed: value !== this.baseline[name] };
    });
    return this.changesOnly ? lines.filter((line) => line.changed) : lines;
  }

  commandText() {
    return this.commandLines()
      .map((line) => `${line.name} ${line.value}`)
      .join('\n');
  }

  /**
   * Reads console lines or a settings_ddnet.cfg file. Settings missing from the text get their default,
   * like the game does, and the result becomes the baseline for "changed" values.
   * Returns the number of values found.
   */
  loadConfigText(text) {
    const found = {};
    let count = 0;
    const pattern = /\b(cl_dyncam|cl_(?:dyncam|mouse)_[a-z_]+|inp_mousesens)\s+"?(-?\d+)"?/g;
    for (const [, name, value] of text.matchAll(pattern)) {
      if (name !== 'cl_dyncam' && !(name in SETTINGS_BY_NAME)) continue;
      found[name] = Number(value);
      count++;
    }
    if (count === 0) return 0;

    this.replaceValues(found);
    this.dyncam = Boolean(found.cl_dyncam);
    this.baseline = { ...this.values, cl_dyncam: this.dyncam ? 1 : 0 };
    this.notify();
    return count;
  }

  /* ---------- Share link ---------- */

  /**
   * Link fragment: "s" + cl_dyncam + the camera settings, separated by dots.
   * Only letters, digits and dots are used so the fragment survives every host.
   */
  shareToken() {
    const numbers = [this.dyncam ? 1 : 0, ...CAMERA_SETTINGS.map((setting) => this.values[setting.name])];
    return 's' + numbers.join('.');
  }

  /** Applies a share token. Returns false if the token is not valid. */
  loadShareToken(token) {
    if (!/^s\d+(\.\d+)*$/.test(token)) return false;
    const [dyncam, ...numbers] = token.slice(1).split('.').map(Number);
    if (numbers.length !== CAMERA_SETTINGS.length) return false;

    const values = Object.fromEntries(CAMERA_SETTINGS.map((setting, index) => [setting.name, numbers[index]]));
    this.replaceValues({ ...values, inp_mousesens: this.values.inp_mousesens });
    this.dyncam = dyncam !== 0;
    this.baseline = ConfigStore.defaultBaseline();
    this.notify();
    return true;
  }

  /* ---------- Browser storage ---------- */

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  save() {
    const data = {
      values: this.values,
      dyncam: this.dyncam,
      baseline: this.baseline,
      changesOnly: this.changesOnly,
      screenFormat: this.screenFormat,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable (private window, blocked site data).
    }
  }

  /** Restores the last saved state. Returns false if there is none. */
  restore() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return false;
    }
    if (!data || typeof data !== 'object') return false;

    if (data.values) this.replaceValues(data.values);
    if (typeof data.dyncam === 'boolean') this.dyncam = data.dyncam;
    if (typeof data.changesOnly === 'boolean') this.changesOnly = data.changesOnly;
    if (typeof data.screenFormat === 'string') this.screenFormat = data.screenFormat;
    if (data.baseline) {
      const baseline = ConfigStore.defaultBaseline();
      for (const name of Object.keys(baseline)) {
        if (Number.isFinite(data.baseline[name])) baseline[name] = data.baseline[name];
      }
      this.baseline = baseline;
    }
    this.notify();
    return true;
  }
}
