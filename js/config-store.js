import {
  SETTINGS,
  SETTINGS_BY_NAME,
  CAMERA_SETTINGS,
  REQUEST_NAMES,
  DEFAULT_DYNCAM,
  commandNames,
  clampToRange,
  defaultValues,
} from './settings.js';

const STORAGE_KEY = 'dyncam-editor';
const SAVE_DELAY_MS = 300;

/**
 * Current setting values, the camera mode shown, and the baseline that
 * "changed" values are compared to (the DDNet defaults, or the values loaded from the game).
 * Listeners registered with onChange() run after every modification.
 */
export class ConfigStore {
  constructor() {
    this.values = defaultValues();
    this.dyncam = true;
    this.baseline = ConfigStore.defaultBaseline();
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

  /** Screen format of the game view. Kept in the browser, not in share links. */
  setScreenFormat(id) {
    this.screenFormat = id;
    this.notify();
  }

  /** Sets every setting like a config file does: listed values are used, the others get their default. */
  replaceValues(values) {
    const source = values && typeof values === 'object' ? values : {};
    for (const setting of SETTINGS) {
      const value = Object.hasOwn(source, setting.name) ? Number(source[setting.name]) : setting.defaultValue;
      this.values[setting.name] = clampToRange(setting, value);
    }
  }

  /** True when cl_dyncam and every camera setting equal the baseline. inp_mousesens is not compared. */
  isAtBaseline() {
    if (this.commandValue('cl_dyncam') !== this.baseline.cl_dyncam) return false;
    return CAMERA_SETTINGS.every((setting) => this.values[setting.name] === this.baseline[setting.name]);
  }

  /** True when the baseline comes from a loaded config, not from the DDNet defaults. */
  hasLoadedBaseline() {
    const defaults = ConfigStore.defaultBaseline();
    if (this.baseline.cl_dyncam !== defaults.cl_dyncam) return true;
    return CAMERA_SETTINGS.some((setting) => this.baseline[setting.name] !== defaults[setting.name]);
  }

  /**
   * What Reset does now:
   * 'baseline' back to the loaded values, 'defaults' back to the DDNet defaults once there,
   * 'all' back to the DDNet defaults when nothing was loaded.
   */
  resetTarget() {
    if (!this.hasLoadedBaseline()) return 'all';
    return this.isAtBaseline() ? 'defaults' : 'baseline';
  }

  /**
   * Reset all. inp_mousesens is the user's own sensitivity and is kept.
   * Back to the loaded values includes their cl_dyncam; back to the defaults keeps the camera mode shown.
   */
  reset() {
    if (this.resetTarget() === 'baseline') {
      this.replaceValues({ ...this.baseline, inp_mousesens: this.values.inp_mousesens });
      this.dyncam = this.baseline.cl_dyncam >= 1;
    } else {
      this.replaceValues({ inp_mousesens: this.values.inp_mousesens });
      this.baseline = ConfigStore.defaultBaseline();
    }
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
    return commandNames(this.dyncam).map((name) => {
      const value = this.commandValue(name);
      return { name, value, changed: value !== this.baseline[name] };
    });
  }

  commandText() {
    return this.commandLines()
      .map((line) => `${line.name} ${line.value}`)
      .join('\n');
  }

  /** Console line that prints every value read by loadConfigText(): "cl_dyncam; cl_dyncam_max_distance; …". */
  static requestText() {
    return REQUEST_NAMES.join('; ');
  }

  /**
   * Reads one of these texts and makes the result the baseline for "changed" values:
   * - the console output of requestText(): "> cl_dyncam; …" then one "Value: N" line per name.
   *   Values missing from it are kept, as the selection can miss a few lines;
   * - a settings_ddnet.cfg file or console commands like "cl_dyncam_deadzone 300".
   *   Camera settings missing from it get their default, like the game does,
   *   and inp_mousesens is only changed when the text has it.
   * Returns { source: 'console' | 'commands', found, expected }: the number of values found,
   * and for console output the number of values the request asked for.
   */
  loadConfigText(text) {
    const output = readConsoleOutput(text);
    if (output) {
      if (output.found.size) this.applyLoaded({ ...this.currentValues(), ...Object.fromEntries(output.found) });
      return { source: 'console', found: output.found.size, expected: output.expected };
    }

    const found = readCommands(text);
    const count = Object.keys(found).length;
    if (count) this.applyLoaded({ inp_mousesens: this.values.inp_mousesens, ...found });
    return { source: 'commands', found: count, expected: count };
  }

  /** Values and cl_dyncam in one object, like a config file. */
  currentValues() {
    return { ...this.values, cl_dyncam: this.commandValue('cl_dyncam') };
  }

  /** Sets values like a config file does and makes them the baseline. */
  applyLoaded(values) {
    this.replaceValues(values);
    // cl_dyncam is a 0–1 setting: the game clamps other values into that range.
    this.dyncam = (values.cl_dyncam ?? DEFAULT_DYNCAM) >= 1;
    this.baseline = this.currentValues();
    this.notify();
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
      screenFormat: this.screenFormat,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable (private window, blocked site data).
    }
  }

  /** Restores the last saved state. Returns false if there is none. Values of the wrong type are ignored. */
  restore() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return false;
    }
    if (!data || typeof data !== 'object') return false;

    if (data.values && typeof data.values === 'object') this.replaceValues(data.values);
    if (typeof data.dyncam === 'boolean') this.dyncam = data.dyncam;
    if (typeof data.screenFormat === 'string') this.screenFormat = data.screenFormat;
    if (data.baseline && typeof data.baseline === 'object') {
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

const VALUE_NAME = /^(?:cl_dyncam|cl_(?:dyncam|mouse)_[a-z_]+|inp_mousesens)$/;
const isKnownName = (name) => name === 'cl_dyncam' || name in SETTINGS_BY_NAME;

/**
 * Reads the game console output of ConfigStore.requestText(). Each executed line is printed as "> line",
 * then each name prints "… config: Value: N" in the same order, or "No such command: name." in older versions.
 * Returns null if the text has no "> " line with a known name, else { found: Map(name → value), expected }.
 */
function readConsoleOutput(text) {
  const found = new Map();
  let queue = [];
  let expected = 0;
  let isOutput = false;

  for (const line of text.split(/\r?\n/)) {
    const executed = line.match(/^\s*>\s*(.*)$/);
    if (executed) {
      queue = executed[1]
        .split(';')
        .map((part) => part.trim())
        .filter((name) => VALUE_NAME.test(name) && isKnownName(name));
      if (queue.length) {
        isOutput = true;
        expected += queue.length;
      }
      continue;
    }
    const unknown = line.match(/No such command: '?([a-z_]+)/);
    if (unknown && queue.includes(unknown[1])) {
      queue.splice(queue.indexOf(unknown[1]), 1);
      expected--;
      continue;
    }
    const value = line.match(/Value: (-?\d+)/);
    if (value && queue.length) found.set(queue.shift(), Number(value[1]));
  }
  return isOutput ? { found, expected } : null;
}

/** Reads "name value" pairs of a config file or of console commands. Returns { name: value }. */
function readCommands(text) {
  const found = {};
  const pattern = /\b(cl_dyncam|cl_(?:dyncam|mouse)_[a-z_]+|inp_mousesens)\s+"?(-?\d+)"?/g;
  for (const [, name, value] of text.matchAll(pattern)) {
    if (isKnownName(name)) found[name] = Number(value);
  }
  return found;
}
