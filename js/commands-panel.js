const FEEDBACK_MS = 1600;
const UNDO_RESET_MS = 5000;

/** Page address used in share links: the canonical URL if the page declares one, else the current address. */
function pageAddress() {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical?.href) return canonical.href.split('#')[0];
  return location.origin + location.pathname;
}

/** Copies text to the clipboard. Returns true on success. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shows a temporary label on a button, then the original one. */
function flashLabel(label, text, originalText, duration = FEEDBACK_MS) {
  label.textContent = text;
  setTimeout(() => {
    label.textContent = originalText;
  }, duration);
}

/** The Commands section: command list, Changes only, Copy, Share link, Paste config and Reset all. */
export class CommandsPanel {
  constructor({ store }) {
    this.store = store;
    this.list = document.getElementById('commands-list');
    this.copyButton = document.getElementById('copy-button');
    this.changesOnlyToggle = document.getElementById('changes-only');
    this.pasteBox = document.getElementById('paste-box');
    this.pasteButton = document.getElementById('paste-button');
    this.pasteInput = document.getElementById('paste-input');
    this.pasteMessage = document.getElementById('paste-message');
    this.resetLabel = document.getElementById('reset-label');
    this.stateBeforeReset = null;
    this.undoTimer = 0;

    this.changesOnlyToggle.addEventListener('click', () => store.setChangesOnly(!store.changesOnly));
    this.copyButton.addEventListener('click', () => this.copyCommands());
    document.getElementById('share-button').addEventListener('click', () => this.copyShareLink());
    this.pasteButton.addEventListener('click', () => this.togglePasteBox());
    document.getElementById('paste-load').addEventListener('click', () => this.loadPastedConfig());
    document.getElementById('reset-button').addEventListener('click', () => this.resetOrUndo());

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
    if (!lines.length) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = 'No changes';
      this.list.appendChild(empty);
    }
    lines.forEach((line, index) => {
      const element = document.createElement('span');
      if (!line.changed) element.className = 'unchanged';
      element.textContent = `${line.name} ${line.value}` + (index < lines.length - 1 ? '\n' : '');
      this.list.appendChild(element);
    });
    this.copyButton.disabled = !lines.length;
    this.changesOnlyToggle.setAttribute('aria-checked', String(this.store.changesOnly));
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
      this.pasteBox.hidden = false;
      this.pasteInput.value = url;
      this.pasteInput.select();
    }
    flashLabel(document.getElementById('share-label'), copied ? 'Link copied' : 'Copy the link below', 'Share link', 1800);
  }

  togglePasteBox() {
    const open = this.pasteBox.hidden;
    this.pasteBox.hidden = !open;
    this.pasteButton.setAttribute('aria-expanded', String(open));
    if (open) this.pasteInput.focus();
  }

  loadPastedConfig() {
    this.loadConfig(this.pasteInput.value, 'your paste');
  }

  loadConfig(text, source) {
    const count = this.store.loadConfigText(text);
    this.pasteMessage.textContent = count
      ? `Loaded ${count} value${count === 1 ? '' : 's'} from ${source}. Anything not in it uses the DDNet default.`
      : `No cl_dyncam_* or cl_mouse_* values found in ${source}.`;
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
      this.pasteBox.hidden = false;
      this.pasteButton.setAttribute('aria-expanded', 'true');
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
      this.store.setState(this.stateBeforeReset);
      this.stateBeforeReset = null;
      this.resetLabel.textContent = 'Reset all';
      return;
    }
    this.stateBeforeReset = this.store.getState();
    this.store.resetToDefaults();
    this.resetLabel.textContent = 'Undo reset';
    this.undoTimer = setTimeout(() => {
      this.stateBeforeReset = null;
      this.resetLabel.textContent = 'Reset all';
    }, UNDO_RESET_MS);
  }
}
