import { copyText, flashLabel } from './clipboard.js';

/** Folder of settings_ddnet.cfg on each system, how to open it, and the fallback for unknown systems. */
const FOLDERS = {
  windows: {
    path: '%APPDATA%\\DDNet',
    tip: 'Press Win+R, paste the folder, then Enter.',
  },
  linux: {
    path: '~/.local/share/ddnet',
    tip: 'In your file manager, press Ctrl+L, paste the folder, then Enter.',
  },
  macos: {
    path: '~/Library/Application Support/DDNet',
    tip: 'In the Finder, press Cmd+Shift+G, paste the folder, then Enter.',
  },
};

function detectSystem() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/win/i.test(platform)) return 'windows';
  if (/mac/i.test(platform)) return 'macos';
  return 'linux';
}

/** The "Where is settings_ddnet.cfg?" popup: a capture of the game menu and the folder of each system. */
export class ConfigHelp {
  constructor() {
    this.popup = document.getElementById('where-popup');
    this.tabs = [...this.popup.querySelectorAll('.os-tab')];
    this.path = document.getElementById('os-path');
    this.tip = document.getElementById('os-tip');
    this.opener = null;

    for (const tab of this.tabs) tab.addEventListener('click', () => this.showSystem(tab.dataset.os));
    document.getElementById('os-path-copy').addEventListener('click', async () => {
      const copied = await copyText(this.path.textContent);
      flashLabel(document.getElementById('os-path-label'), copied ? 'Copied' : 'Select it and copy it', 'Copy');
    });
    document.getElementById('where-close').addEventListener('click', () => this.close());
    this.popup.addEventListener('pointerdown', (event) => {
      if (event.target === this.popup) this.close();
    });
    this.popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.showSystem(detectSystem());
  }

  showSystem(system) {
    for (const tab of this.tabs) tab.setAttribute('aria-selected', String(tab.dataset.os === system));
    this.path.textContent = FOLDERS[system].path;
    this.tip.textContent = FOLDERS[system].tip;
  }

  open() {
    this.opener = document.activeElement;
    this.popup.hidden = false;
    document.getElementById('where-close').focus();
  }

  close() {
    this.popup.hidden = true;
    this.opener?.focus();
  }
}
