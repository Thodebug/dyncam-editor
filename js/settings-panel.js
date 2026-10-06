import { SETTINGS } from './settings.js';
import { cursorLimits } from './camera.js';

/** Half the width of a slider knob, in UI units: the knob center can't get closer to the rail ends. */
const KNOB_HALF_WIDTH = 16.5;

/** CSS position of a value on a slider rail, matching the knob center. */
function railPosition(fraction) {
  return `calc(${KNOB_HALF_WIDTH} * var(--u) + (100% - ${2 * KNOB_HALF_WIDTH} * var(--u)) * ${fraction.toFixed(4)})`;
}

function sliderMaximum(setting) {
  return setting.sliderMax ?? setting.max;
}

/**
 * Explains how the game uses the current values.
 * Returns, by setting name:
 * - messages: { text, warning } shown under the setting (warning = a configuration trap)
 * - inactiveFrom: the value from which the setting has no effect, to grey out the rest of the rail
 */
export function describeSettings(values) {
  const messages = {};
  const inactiveFrom = {};

  for (const dyncam of [true, false]) {
    const limits = cursorLimits(values, dyncam);
    const prefix = dyncam ? 'cl_dyncam_' : 'cl_mouse_';
    const followFactorName = dyncam ? 'cl_dyncam_follow_factor' : 'cl_mouse_followfactor';
    const effectiveMax = Math.round(limits.effectiveMax);

    if (limits.followFactor === 0) {
      messages[prefix + 'deadzone'] = { text: `No effect while ${followFactorName} is 0.` };
      inactiveFrom[prefix + 'deadzone'] = 0;
    } else if (limits.deadzone >= limits.maxDistance) {
      messages[prefix + 'deadzone'] = {
        text: `The camera never moves: the deadzone reaches ${prefix}max_distance (${limits.maxDistance}).`,
        warning: true,
      };
      inactiveFrom[prefix + 'deadzone'] = limits.maxDistance;
    }

    if (limits.effectiveMax < limits.maxDistance) {
      messages[prefix + 'max_distance'] = {
        text: `Effective max: ${effectiveMax} (deadzone + follow factor). Higher values do nothing.`,
      };
      inactiveFrom[prefix + 'max_distance'] = limits.effectiveMax;
    }

    if (limits.minDistance > 0 && limits.minDistance >= limits.effectiveMax) {
      messages[prefix + 'min_distance'] = {
        text: `The cursor is locked ${effectiveMax} units from your tee: min ≥ max cursor distance (${effectiveMax}).`,
        warning: true,
      };
      inactiveFrom[prefix + 'min_distance'] = limits.effectiveMax;
    }
  }

  if (values.cl_dyncam_smoothness === 0 && values.cl_dyncam_stabilizing > 0) {
    messages.cl_dyncam_stabilizing = { text: 'No effect while cl_dyncam_smoothness is 0.' };
  }

  return { messages, inactiveFrom };
}

/**
 * The settings column: one row per setting (name, info tooltip, number input, slider, message),
 * grouped in the cl_dyncam 1, cl_dyncam 0 and Capture mouse blocks.
 * Clicking a camera block shows that camera mode in the game view.
 */
export class SettingsPanel {
  /** onFocus(name | null) is called when a setting row is hovered or focused. */
  constructor({ store, onFocus }) {
    this.store = store;
    this.rows = [];
    this.dyncamBlock = document.getElementById('block-dyncam');
    this.mouseBlock = document.getElementById('block-mouse');

    for (const setting of SETTINGS) this.rows.push(this.createRow(setting, onFocus));

    for (const [block, dyncam] of [[this.dyncamBlock, true], [this.mouseBlock, false]]) {
      block.addEventListener('pointerdown', () => store.setDyncam(dyncam), true);
      block.addEventListener('focusin', () => store.setDyncam(dyncam));
    }
    for (const details of document.querySelectorAll('.more-settings')) {
      details.addEventListener('toggle', () => this.fitNames());
    }
  }

  createRow(setting, onFocus) {
    const row = document.createElement('div');
    row.className = 'setting';
    const defaultFraction = (setting.defaultValue - setting.min) / (sliderMaximum(setting) - setting.min);
    row.innerHTML = `
      <div class="setting-header">
        <span class="setting-color"></span>
        <span class="setting-name">${setting.name}</span>
        <button class="info-button icon" type="button" aria-label="About ${setting.name}">&#xF05A;</button>
        <input class="number-input" type="number" inputmode="numeric" min="${setting.min}" max="${setting.max}" step="1" aria-label="${setting.name}">
      </div>
      <div class="slider">
        <span class="default-mark" style="left: ${railPosition(defaultFraction)}"></span>
        <input type="range" min="${setting.min}" max="${sliderMaximum(setting)}" step="1" aria-label="${setting.name}">
      </div>
      <div class="setting-message" hidden></div>`;

    if (setting.ringColor) row.querySelector('.setting-color').style.setProperty('--ring-color', `var(${setting.ringColor})`);
    const note = setting.note ? ` ${setting.note}` : '';
    row.querySelector('.info-button').dataset.tip =
      `${setting.description}.${note} Range ${setting.min}–${setting.max}, default ${setting.defaultValue}.`;

    const container = setting.group + (setting.advanced ? '-more' : '');
    document.getElementById(`settings-${container}`).appendChild(row);

    const numberInput = row.querySelector('.number-input');
    const slider = row.querySelector('input[type="range"]');
    const message = row.querySelector('.setting-message');

    slider.addEventListener('input', () => this.store.set(setting.name, Number(slider.value)));

    // Whole numbers only, always inside the game's range
    numberInput.addEventListener('keydown', (event) => {
      if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) event.preventDefault();
    });
    numberInput.addEventListener('input', () => {
      const digits = String(numberInput.value).replace(/\D/g, '');
      if (digits === '') return;
      const value = Math.min(Math.max(parseInt(digits, 10), setting.min), setting.max);
      if (String(value) !== String(numberInput.value)) numberInput.value = value;
      this.store.set(setting.name, value);
    });
    const showStoredValue = () => {
      numberInput.value = this.store.values[setting.name];
    };
    numberInput.addEventListener('change', showStoredValue);
    numberInput.addEventListener('blur', showStoredValue);

    row.addEventListener('pointerenter', () => onFocus(setting.name));
    row.addEventListener('pointerleave', () => onFocus(null));
    row.addEventListener('focusin', () => onFocus(setting.name));
    row.addEventListener('focusout', () => onFocus(null));

    return { setting, numberInput, slider, message };
  }

  /** Shows the store's values, messages and active camera mode. */
  update() {
    const values = this.store.values;
    const { messages, inactiveFrom } = describeSettings(values);

    for (const { setting, numberInput, slider, message } of this.rows) {
      const value = values[setting.name];
      const top = sliderMaximum(setting);
      slider.value = Math.min(value, top);
      if (document.activeElement !== numberInput) numberInput.value = value;

      const info = messages[setting.name];
      message.hidden = !info;
      message.textContent = info ? info.text : '';
      message.classList.toggle('is-warning', Boolean(info?.warning));

      const inactive = inactiveFrom[setting.name];
      if (inactive === undefined || inactive >= top) {
        slider.style.removeProperty('--track');
      } else {
        const fraction = Math.max(0, (inactive - setting.min) / (top - setting.min));
        slider.style.setProperty('--track', `linear-gradient(to right, var(--rail) ${railPosition(fraction)}, var(--rail-inactive) 0)`);
      }
    }

    this.dyncamBlock.classList.toggle('is-active', this.store.dyncam);
    this.mouseBlock.classList.toggle('is-active', !this.store.dyncam);
  }

  /**
   * Like CUi::DoLabel, lowers the font size until the names fit, using one size for every name
   * so the column reads evenly.
   */
  fitNames() {
    const names = [...document.querySelectorAll('.setting-name')];
    const visible = names.find((name) => name.clientWidth > 0);
    if (!visible) return;

    const unit = parseFloat(getComputedStyle(document.body).fontSize) / 12.8;
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${12 * unit}px ${getComputedStyle(visible).fontFamily}`;
    const available = visible.clientWidth - 1;

    let size = 12;
    for (const name of names) {
      const width = context.measureText(name.textContent).width;
      if (width > available) size = Math.min(size, Math.floor(((12 * available) / width) * 2) / 2);
    }
    size = Math.max(size, 7);
    for (const name of names) name.style.fontSize = `calc(${size} * var(--u))`;
  }
}
