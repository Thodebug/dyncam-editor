const f = Math.fround;

/** IGraphics::CalcScreenParams(): visible world size for a screen aspect ratio and zoom, in 32-bit floats. */
export function calcScreenParams(aspect, zoom) {
  const amount = 1150 * 1000;
  const maxWidth = 1500;
  const maxHeight = 1050;
  const factor = f(f(Math.sqrt(amount)) / f(Math.sqrt(f(aspect))));
  let width = f(factor * f(aspect));
  let height = factor;
  if (width > maxWidth) {
    width = maxWidth;
    height = f(width / f(aspect));
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = f(height * f(aspect));
  }
  return { width: f(width * zoom), height: f(height * zoom) };
}

/** IGraphics::MapScreenToWorld(): world rectangle { left, top, right, bottom } shown for a group. */
export function mapScreenToWorld(centerX, centerY, parallaxX, parallaxY, parallaxZoom, offsetX, offsetY, aspect, zoom) {
  let { width, height } = calcScreenParams(aspect, zoom);
  const scale = f(f(f(f(parallaxZoom * f(zoom - 1)) + 100) / 100) / f(zoom));
  width = f(width * scale);
  height = f(height * scale);
  const x = f(centerX * f(parallaxX / 100));
  const y = f(centerY * f(parallaxY / 100));
  const left = f(f(offsetX + x) - f(width / 2));
  const top = f(f(offsetY + y) - f(height / 2));
  return { left, top, right: f(left + width), bottom: f(top + height) };
}

/**
 * Draws the layers of a map like CMapLayers: the layers before the game layer behind the players,
 * the layers after it in front. The game layer itself is not drawn (cl_overlay_entities 0).
 * Envelopes (animations), group clipping and tiles outside the layers are not drawn; ctf5 uses none of them
 * within the camera's reach.
 */
export class MapRenderer {
  /**
   * map: from readMap(). images: { name: HTMLImageElement } for the external images (data/mapres).
   */
  constructor(graphics, map, images) {
    this.graphics = graphics;
    this.map = map;
    this.images = images;
    this.upload();
  }

  /** Creates the textures and buffers on the GPU. Called again after the WebGL context is restored. */
  upload() {
    const graphics = this.graphics;
    const { groups, images } = this.map;

    // CMapImages: an image used by tile layers becomes a 2D array texture, one used by quad layers a 2D texture.
    const usedByTiles = new Set();
    const usedByQuads = new Set();
    for (const group of groups) {
      for (const layer of group.layers) {
        if (layer.image < 0 || layer.image >= images.length) continue;
        if (layer.type === 'tiles' && !layer.game) usedByTiles.add(layer.image);
        if (layer.type === 'quads') usedByQuads.add(layer.image);
      }
    }
    const textures = images.map((image, index) => {
      if (!usedByTiles.has(index) && !usedByQuads.has(index)) return null;
      const source = this.images[image.name];
      if (!source) throw new Error(`Missing map image ${image.name}`);
      const pixels = graphics.readImagePixels(source);
      return {
        array: usedByTiles.has(index) ? graphics.createTileArrayTexture(pixels) : null,
        flat: usedByQuads.has(index) ? graphics.createTexture(pixels, { wrap: 'repeat' }) : null,
      };
    });

    this.background = [];
    this.foreground = [];
    let passedGameLayer = false;
    for (const group of groups) {
      const behind = { group, layers: [] };
      const inFront = { group, layers: [] };
      for (const layer of group.layers) {
        if (layer.type === 'tiles' && layer.game) {
          passedGameLayer = true;
          continue;
        }
        const target = passedGameLayer ? inFront : behind;
        if (layer.type === 'tiles') {
          const tiles = [];
          for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
              const offset = (y * layer.width + x) * 4;
              if (layer.tiles[offset] > 0) tiles.push({ x, y, index: layer.tiles[offset], flags: layer.tiles[offset + 1] });
            }
          }
          const texture = textures[layer.image]?.array;
          if (!tiles.length || !texture) continue;
          target.layers.push({
            type: 'tiles',
            buffer: graphics.createTileBuffer(tiles, layer.height),
            texture,
            color: layer.color.map((channel) => channel / 255),
          });
        } else if (layer.quads.length) {
          target.layers.push({
            type: 'quads',
            buffer: graphics.createQuadBuffer(layer.quads),
            texture: textures[layer.image]?.flat ?? null,
          });
        }
      }
      if (behind.layers.length) this.background.push(behind);
      if (inFront.layers.length) this.foreground.push(inFront);
    }
  }

  /** Draws the 'background' or 'foreground' layers for a camera at `center`, with the screen `aspect` and `zoom`. */
  render(part, center, aspect, zoom = 1) {
    const graphics = this.graphics;
    for (const { group, layers } of part === 'background' ? this.background : this.foreground) {
      // CRenderLayerGroup::Render()
      const parallaxZoom = Math.min(Math.max(Math.max(group.parallaxX, group.parallaxY), 0), 100);
      const rect = mapScreenToWorld(
        center.x,
        center.y,
        group.parallaxX,
        group.parallaxY,
        parallaxZoom,
        group.offsetX,
        group.offsetY,
        aspect,
        zoom,
      );
      graphics.mapScreen(rect.left, rect.top, rect.right, rect.bottom);
      for (const layer of layers) {
        if (layer.type === 'tiles') graphics.drawTileLayer(layer.buffer, layer.texture, layer.color);
        else graphics.drawQuadLayer(layer.buffer, layer.texture);
      }
    }
  }
}
