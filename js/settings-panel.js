import { SETTINGS, SETTINGS_BY_NAME } from './settings.js';
import { CAMERA_MAX_DISTANCE, cursorLimits } from './camera.js';
import { coloredValue, fraction, tipMarkup } from './tooltip.js';

/** Half the width of a slider knob, in UI units: the knob center can't get closer to the rail ends. */
const KNOB_HALF_WIDTH = 16.5;

/** CSS position on a slider rail of a share (0 to 1) of its range, matching the knob center. */
function railPosition(share) {
  return `calc(${KNOB_HALF_WIDTH} * var(--u) + (100% - ${2 * KNOB_HALF_WIDTH} * var(--u)) * ${share.toFixed(4)})`;
}

function sliderMaximum(setting) {
  return setting.sliderMax ?? setting.max;
}

/**
 * Configuration traps of the current values.
 * Returns, by setting name:
 * - warnings: text shown under the setting
 * - inactiveFrom: the value from which the setting has no effect, to grey out the rest of the rail
 */
export function describeSettings(values) {
  const warnings = {};
  const inactiveFrom = {};

  for (const dyncam of [true, false]) {
    const limits = cursorLimits(values, dyncam);
    const prefix = dyncam ? 'cl_dyncam_' : 'cl_mouse_';

    if (limits.followFactor === 0) {
      inactiveFrom[prefix + 'deadzone'] = 0;
    } else if (limits.deadzone >= limits.maxDistance) {
      warnings[prefix + 'deadzone'] = 'Camera never moves (deadzone ≥ max_distance).';
      inactiveFrom[prefix + 'deadzone'] = limits.maxDistance;
    }

    if (limits.effectiveMax < limits.maxDistance) inactiveFrom[prefix + 'max_distance'] = limits.effectiveMax;

    if (limits.minDistance > 0 && limits.minDistance >= limits.effectiveMax) {
      warnings[prefix + 'min_distance'] = `Cursor stuck at ${Math.round(limits.effectiveMax)} (min ≥ max distance).`;
      inactiveFrom[prefix + 'min_distance'] = limits.effectiveMax;
    }
  }

  return { warnings, inactiveFrom };
}

/** Tooltip HTML of a setting: its text, live details for the current values, then its range and default. */
function settingTip(setting, values) {
  const parts = [`<div>${tipMarkup(setting.tip)}</div>`];
  const dyncam = setting.group === 'dyncam';
  const prefix = dyncam ? 'cl_dyncam_' : 'cl_mouse_';
  const followFactorName = dyncam ? 'cl_dyncam_follow_factor' : 'cl_mouse_followfactor';
  const followFactorLabel = dyncam ? 'follow_factor' : 'followfactor';
  const limits = setting.group === 'preview' ? null : cursorLimits(values, dyncam);

  if (setting.name === prefix + 'max_distance' && limits.followFactor > 0) {
    // CControls::GetMaxMouseDistance(): past this distance the camera offset would exceed CAMERA_MAX_DISTANCE
    const limit = (CAMERA_MAX_DISTANCE * 100) / limits.followFactor + limits.deadzone;
    const rounded = Math.round(limit);
    const numerator = `${CAMERA_MAX_DISTANCE} × 100`;
    const followColor = SETTINGS_BY_NAME[followFactorName].ringColor;
    const deadzoneColor = SETTINGS_BY_NAME[prefix + 'deadzone'].ringColor;
    parts.push(
      '<div class="tip-note">Higher than the limit below does nothing.</div>',
      `<div class="tip-formula">limit = ${fraction(numerator, followFactorLabel)} + deadzone</div>`,
      `<div class="tip-formula">${coloredValue(rounded, setting.ringColor)} ${rounded === limit ? '=' : '≈'} ` +
        `${fraction(numerator, coloredValue(limits.followFactor, followColor))} + ` +
        `${coloredValue(limits.deadzone, deadzoneColor)}</div>`,
    );
  }
  if (setting.name === prefix + 'deadzone' && limits.followFactor === 0) {
    parts.push(`<div class="tip-note"><b>No effect</b>: ${followFactorLabel} is 0.</div>`);
  }
  if (setting.name === 'cl_dyncam_stabilizing' && values.cl_dyncam_smoothness === 0) {
    parts.push('<div class="tip-note"><b>No effect</b>: smoothness is 0.</div>');
  }

  parts.push(`<div class="tip-footer">Range ${setting.min}–${setting.max} · Default ${setting.defaultValue}</div>`);
  return parts.join('');
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
    const infoButton = row.querySelector('.info-button');
    infoButton.classList.add('has-tip');
    infoButton.tipContent = () => settingTip(setting, this.store.values);

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

    row.addEventListener('animationend', () => row.classList.remove('is-highlighted'));

    return { setting, row, numberInput, slider, message };
  }

  /** Lights up the rows of these settings for a moment, to show the values a load changed. */
  highlight(names) {
    for (const { setting, row } of this.rows) {
      if (!names.includes(setting.name)) continue;
      row.classList.remove('is-highlighted');
      // Reading the layout restarts the animation when the row is already lit.
      void row.offsetWidth;
      row.classList.add('is-highlighted');
    }
  }

  /** Shows the store's values, messages and active camera mode. */
  update() {
    const values = this.store.values;
    const { warnings, inactiveFrom } = describeSettings(values);

    for (const { setting, numberInput, slider, message } of this.rows) {
      const value = values[setting.name];
      const top = sliderMaximum(setting);
      slider.value = Math.min(value, top);
      if (document.activeElement !== numberInput) numberInput.value = value;

      const warning = warnings[setting.name];
      message.hidden = !warning;
      message.textContent = warning ?? '';

      const inactive = inactiveFrom[setting.name];
      if (inactive === undefined || inactive >= top) {
        slider.style.removeProperty('--track');
      } else {
        const inactiveShare = Math.max(0, (inactive - setting.min) / (top - setting.min));
        slider.style.setProperty(
          '--track',
          `linear-gradient(to right, var(--rail) ${railPosition(inactiveShare)}, var(--rail-inactive) 0)`,
        );
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
