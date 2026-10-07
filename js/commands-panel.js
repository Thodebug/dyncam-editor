import { ConfigStore } from './config-store.js';
import { ConfigHelp } from './config-help.js';
import { copyText, flashLabel } from './clipboard.js';

const UNDO_RESET_MS = 5000;

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
  constructor({ store }) {
    this.store = store;
    this.list = document.getElementById('commands-list');
    this.loadBox = document.getElementById('load-box');
    this.loadButton = document.getElementById('load-button');
    this.pasteInput = document.getElementById('paste-input');
    this.pasteMessage = document.getElementById('paste-message');
    this.resetButton = document.getElementById('reset-button');
    this.resetLabel = document.getElementById('reset-label');
    this.configHelp = new ConfigHelp();
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

  async copyRequest() {
    const request = ConfigStore.requestText();
    const copied = await copyText(request);
    if (!copied) {
      // Show the request in the paste box so it can be copied by hand.
      this.pasteInput.value = request;
      this.pasteInput.select();
    }
    flashLabel(document.getElementById('request-label'), copied ? 'Copied' : 'Copy the text below', 'Copy request');
  }

  openLoadBox() {
    this.loadBox.hidden = false;
    this.loadButton.setAttribute('aria-expanded', 'true');
  }

  toggleLoadBox() {
    const open = this.loadBox.hidden;
    this.loadBox.hidden = !open;
    this.loadButton.setAttribute('aria-expanded', String(open));
  }

  loadPastedConfig() {
    this.loadConfig(this.pasteInput.value, 'your paste');
  }

  /** Loads a pasted text or a dropped file. source names it in the message. */
  loadConfig(text, source) {
    const { source: format, found, expected } = this.store.loadConfigText(text);
    if (!found) {
      this.pasteMessage.textContent = 'No camera settings found.';
    } else if (format === 'console' && found < expected) {
      this.pasteMessage.textContent = `Loaded ${found} of ${expected} values. Select all the lines next time.`;
    } else if (format === 'console') {
      this.pasteMessage.textContent = `Loaded ${plural(found, 'value')} from the game.`;
    } else {
      this.pasteMessage.textContent = `Loaded ${plural(found, 'value')} from ${source}. Anything not in it uses the DDNet default.`;
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
      this.loadConfig(await file.text(), file.name);
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
