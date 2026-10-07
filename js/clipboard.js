const FEEDBACK_MS = 1600;

/** Copies text to the clipboard. Returns true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shows a temporary label on a button, then the original one. */
export function flashLabel(label, text, originalText, duration = FEEDBACK_MS) {
  label.textContent = text;
  setTimeout(() => {
    label.textContent = originalText;
  }, duration);
}
