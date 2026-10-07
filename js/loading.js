/** Decodes an image file. */
export async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return image;
}

/**
 * Downloads files. urls: { key: url }. Returns { key: Blob }.
 * onProgress({ loaded, total, filesDone, fileCount }) is called as bytes arrive.
 * total is null when a size is unknown (no Content-Length, or a compressed response).
 */
export async function downloadFiles(urls, onProgress) {
  const entries = Object.entries(urls);
  const responses = await Promise.all(entries.map(([, url]) => fetch(url)));
  for (const response of responses) {
    if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`);
  }

  const sizes = responses.map((response) =>
    response.headers.has('Content-Encoding') ? 0 : Number(response.headers.get('Content-Length')) || 0,
  );
  const progress = {
    loaded: 0,
    total: sizes.every((size) => size > 0) ? sizes.reduce((sum, size) => sum + size, 0) : null,
    filesDone: 0,
    fileCount: entries.length,
  };
  onProgress(progress);

  const blobs = await Promise.all(
    responses.map(async (response) => {
      const reader = response.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        progress.loaded += value.length;
        onProgress(progress);
      }
      progress.filesDone++;
      onProgress(progress);
      return new Blob(chunks, { type: response.headers.get('Content-Type') ?? '' });
    }),
  );

  return Object.fromEntries(entries.map(([key], index) => [key, blobs[index]]));
}

/**
 * Loading screen over the game view, like the DDNet client while it joins a server:
 * the menu background and a box with a title, a line of detail and a progress bar.
 */
export class LoadingScreen {
  constructor(element) {
    this.element = element;
    this.title = element.querySelector('.loading-title');
    [this.detail, this.secondDetail] = element.querySelectorAll('.loading-detail');
    this.bar = element.querySelector('.loading-bar');
    this.startTime = performance.now();
    this.mapName = '';
  }

  /** Shows the screen for a map download. The name appears as in DDNet's "Downloading map: <name>". */
  start(mapName) {
    this.mapName = mapName;
    this.startTime = performance.now();
    this.element.classList.remove('is-error');
    this.element.hidden = false;
  }

  /** A title, one or two lines of detail, and a progress bar from 0 to 1 (none when null). */
  show(title, detail, progress, secondDetail = '') {
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.secondDetail.textContent = secondDetail;
    this.secondDetail.hidden = !secondDetail;
    this.bar.hidden = progress === null;
    if (progress !== null) this.bar.style.setProperty('--progress', String(Math.min(Math.max(progress, 0), 1)));
  }

  /** CMenus::RenderPopupLoading() while the map downloads: "<received>/<total> KiB (<speed> KiB/s)". */
  showDownload({ loaded, total, filesDone, fileCount }) {
    const title = `Downloading map: ${this.mapName}`;
    if (total === null) {
      this.show(title, '', filesDone / fileCount);
      return;
    }
    const seconds = (performance.now() - this.startTime) / 1000;
    const speed = seconds > 0 ? loaded / 1024 / seconds : 0;
    const received = Math.min(loaded, total);
    this.show(
      title,
      `${Math.floor(received / 1024)}/${Math.floor(total / 1024)} KiB (${speed.toFixed(1)} KiB/s)`,
      received / total,
    );
  }

  /** CGameClient's loading callback while the client loads the map: "Connected", "Loading map file from storage". */
  showPreparing(done, total) {
    this.show('Connected', 'Loading map file from storage', done / total);
  }

  showError(detail = 'The map could not be loaded.', secondDetail = 'Reload the page to try again.') {
    this.element.classList.add('is-error');
    this.show('Error', detail, null, secondDetail);
  }

  hide() {
    this.element.hidden = true;
  }
}
