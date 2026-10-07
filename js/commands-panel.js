import { ConfigStore } from './config-store.js';
import { ConfigHelp } from './config-help.js';
import { copyText, flashLabel } from './clipboard.js';

const UNDO_RESET_MS = 5000;
/** Largest text read as a config. settings_ddnet.cfg is about 50 KB; a larger text is not a config. */
const MAX_CONFIG_SIZE = 1024 * 1024;
const COPY_ICON = '\uF0C5';
const CHECK_ICON = '\uF00C';

const RESET_LABELS = {
  baseline: { label: 'Reset all', tip: 'Back to your loaded values.' },
  defaults: { label: 'Reset to defaults', tip: 'Back to the DDNet defaults.' },
  all: { label: 'Reset all', tip: 'Back to the DDNet defaults.' },
};

/** Page address used in share links: the canonical URL if the page declares one, else the current address. */
function pageAddress() {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical?.href) return canonical.href.split('#')[0];
  return location.origin + location.pathname;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The Commands section: command list, Copy, Share link, Load from game and Reset all. */
export class CommandsPanel {
  /** onLoaded(names) is called after a load with the names of the settings it changed. */
  constructor({ store, onLoaded }) {
    this.store = store;
    this.onLoaded = onLoaded;
    this.list = document.getElementById('commands-list');
    this.loadBox = document.getElementById('load-box');
    this.loadButton = document.getElementById('load-button');
    this.pasteInput = document.getElementById('paste-input');
    this.pasteMessage = document.getElementById('paste-message');
    this.resetButton = document.getElementById('reset-button');
    this.resetLabel = document.getElementById('reset-label');
    this.configHelp = new ConfigHelp();
    document.getElementById('request-line').textContent = ConfigStore.requestText();
    this.stateBeforeReset = null;
    this.undoTimer = 0;

    document.getElementById('copy-button').addEventListener('click', () => this.copyCommands());
    document.getElementById('share-button').addEventListener('click', () => this.copyShareLink());
    this.loadButton.addEventListener('click', () => this.toggleLoadBox());
    document.getElementById('request-button').addEventListener('click', () => this.copyRequest());
    document.getElementById('where-button').addEventListener('click', () => this.configHelp.open());
    document.getElementById('paste-load').addEventListener('click', () => this.loadPastedConfig());
    this.resetButton.addEventListener('click', () => this.resetOrUndo());

    this.setupFileDrop();

    // The settings column has no browser context menu, except in the paste box (right click → Paste).
    document.getElementById('sidebar').addEventListener('contextmenu', (event) => {
      if (!event.target.closest('textarea')) event.preventDefault();
    });
  }

  /** Lists the commands. Values equal to the baseline are dimmed. */
  update() {
    const lines = this.store.commandLines();
    this.list.textContent = '';
    lines.forEach((line, index) => {
      const element = document.createElement('span');
      if (!line.changed) element.className = 'unchanged';
      element.textContent = `${line.name} ${line.value}` + (index < lines.length - 1 ? '\n' : '');
      this.list.appendChild(element);
    });
    if (!this.stateBeforeReset) this.showResetTarget();
  }

  showResetTarget() {
    const { label, tip } = RESET_LABELS[this.store.resetTarget()];
    this.resetLabel.textContent = label;
    this.resetButton.dataset.tip = tip;
  }

  async copyCommands() {
    let copied = await copyText(this.store.commandText());
    if (!copied) {
      // Older clipboard API: select the list and copy the selection.
      const range = document.createRange();
      range.selectNodeContents(this.list);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
    }
    flashLabel(document.getElementById('copy-label'), copied ? 'Copied' : 'Select the text and copy it', 'Copy');
  }

  async copyShareLink() {
    const url = `${pageAddress()}#${this.store.shareToken()}`;
    const copied = await copyText(url);
    if (!copied) {
      // Show the link in the paste box so it can be copied by hand.
      this.openLoadBox();
      this.pasteInput.value = url;
      this.pasteInput.select();
    }
    flashLabel(document.getElementById('share-label'), copied ? 'Link copied' : 'Copy the link below', 'Share link', 1800);
  }

  /** Copies the console line that prints the values. If the clipboard is blocked, selects it to copy by hand. */
  async copyRequest() {
    const line = document.getElementById('request-line');
    const icon = document.getElementById('request-icon');
    if (await copyText(line.textContent)) {
      flashLabel(icon, CHECK_ICON, COPY_ICON);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(line);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }

  openLoadBox() {
    this.loadBox.hidden = false;
    this.loadButton.setAttribute('aria-expanded', 'true');
  }

  closeLoadBox() {
    this.loadBox.hidden = true;
    this.loadButton.setAttribute('aria-expanded', 'false');
  }

  toggleLoadBox() {
    if (this.loadBox.hidden) this.openLoadBox();
    else this.closeLoadBox();
  }

  loadPastedConfig() {
    this.loadConfig(this.pasteInput.value);
  }

  /**
   * Loads a pasted text or a dropped file.
   * A complete load closes the box and shows the count on the Load from game button;
   * otherwise the message in the box says what is missing.
   */
  loadConfig(text) {
    if (text.length > MAX_CONFIG_SIZE) {
      this.pasteMessage.textContent = 'This text is too big to be a DDNet config.';
      return;
    }
    const before = { ...this.store.values };
    const { source: format, found, expected } = this.store.loadConfigText(text);
    const changed = Object.keys(before).filter((name) => this.store.values[name] !== before[name]);
    if (changed.length) this.onLoaded(changed);

    const complete = found > 0 && (format !== 'console' || found === expected);
    if (complete) {
      this.closeLoadBox();
      this.pasteInput.value = '';
      this.pasteMessage.textContent = '';
      flashLabel(document.getElementById('load-label'), `Loaded ${plural(found, 'value')}`, 'Load from game', 2000);
      return;
    }

    if (format === 'console' && !found) {
      this.pasteMessage.textContent = `Select all ${expected} lines of the result, then paste them again.`;
    } else if (!found) {
      this.pasteMessage.textContent = 'No camera settings found.';
    } else if (format === 'console' && found < expected) {
      this.pasteMessage.textContent = `Loaded ${found} of ${expected} values. Select all the lines next time.`;
    }
  }

  /** A .cfg file dropped anywhere on the page is loaded like a paste. */
  setupFileDrop() {
    const overlay = document.getElementById('drop-overlay');
    const hasFile = (event) => event.dataTransfer?.types.includes('Files');
    let depth = 0;

    document.addEventListener('dragenter', (event) => {
      if (!hasFile(event)) return;
      depth++;
      overlay.hidden = false;
    });
    document.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.hidden = true;
    });
    document.addEventListener('dragover', (event) => {
      if (hasFile(event)) event.preventDefault();
    });
    document.addEventListener('drop', async (event) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      depth = 0;
      overlay.hidden = true;

      const file = event.dataTransfer.files[0];
      this.openLoadBox();
      if (!file || !file.name.toLowerCase().endsWith('.cfg')) {
        this.pasteMessage.textContent = 'Drop a .cfg file, like settings_ddnet.cfg.';
        return;
      }
      if (file.size > MAX_CONFIG_SIZE) {
        this.pasteMessage.textContent = 'This file is too big to be a DDNet config.';
        return;
      }
      this.loadConfig(await file.text());
    });
  }

  /** Reset all, then for a few seconds the same button undoes the reset. */
  resetOrUndo() {
    clearTimeout(this.undoTimer);
    if (this.stateBeforeReset) {
      const state = this.stateBeforeReset;
      this.stateBeforeReset = null;
      this.store.setState(state);
      return;
    }
    this.stateBeforeReset = this.store.getState();
    this.store.reset();
    this.resetLabel.textContent = 'Undo reset';
    this.resetButton.dataset.tip = 'Back to the values before the reset.';
    this.undoTimer = setTimeout(() => {
      this.stateBeforeReset = null;
      this.showResetTarget();
    }, UNDO_RESET_MS);
  }
}
