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
 * the game layer and the layers after it in front.
 * Normal view (cl_overlay_entities 0): every layer but the game layer.
 * Entities view (cl_overlay_entities 100): only the game layer, with the DDNet entities image.
 * Envelopes (animations) are not used: quads and tile layers are drawn with their base position and color.
 */
export class MapRenderer {
  /**
   * map: from readMap(). images: { name: HTMLImageElement } for the external images (data/mapres).
   * entities: the entities image (data/editor/entities_clear/ddnet.png with the DDNet mask).
   */
  constructor(graphics, map, images, entities) {
    this.graphics = graphics;
    this.map = map;
    this.images = images;
    this.entities = entities;
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
      let pixels = image;
      if (image.external) {
        const source = this.images[image.name];
        if (!source) throw new Error(`Missing map image ${image.name}`);
        pixels = graphics.readImagePixels(source);
      }
      return {
        array: usedByTiles.has(index) ? graphics.createTileArrayTexture(pixels) : null,
        flat: usedByQuads.has(index) ? graphics.createTexture(pixels, { wrap: 'repeat' }) : null,
      };
    });
    const entitiesTexture = graphics.createTileArrayTexture(graphics.readImagePixels(this.entities));
    this.textures = [
      entitiesTexture,
      ...textures.flatMap((texture) => (texture ? [texture.array, texture.flat] : [])),
    ].filter(Boolean);

    this.background = [];
    this.foreground = [];
    let passedGameLayer = false;
    for (const group of groups) {
      const behind = { group, layers: [] };
      const inFront = { group, layers: [] };
      for (const layer of group.layers) {
        if (layer.type === 'tiles' && layer.game) passedGameLayer = true;
        const target = passedGameLayer ? inFront : behind;
        if (layer.type === 'tiles') {
          const texture = layer.game ? entitiesTexture : textures[layer.image]?.array;
          if (!texture) continue;
          const tileLayer = createTileLayer(graphics, layer, texture);
          if (tileLayer) target.layers.push(tileLayer);
        } else if (layer.quads.length) {
          target.layers.push({
            type: 'quads',
            entities: false,
            buffer: graphics.createQuadBuffer(layer.quads),
            texture: textures[layer.image]?.flat ?? null,
          });
        }
      }
      if (behind.layers.length) this.background.push(behind);
      if (inFront.layers.length) this.foreground.push(inFront);
    }
  }

  /** Frees the map's textures and buffers on the GPU, when another map replaces it. */
  dispose() {
    for (const texture of this.textures) this.graphics.deleteTexture(texture);
    for (const { layers } of [...this.background, ...this.foreground]) {
      for (const layer of layers) this.graphics.deleteBuffer(layer.buffer);
    }
  }

  /**
   * Draws the 'background' or 'foreground' layers for a camera at `center`, with the screen `aspect` and `zoom`,
   * in the normal view or the entities view.
   */
  render(part, center, aspect, zoom = 1, entities = false) {
    const graphics = this.graphics;
    for (const { group, layers } of part === 'background' ? this.background : this.foreground) {
      const shown = layers.filter((layer) => layer.entities === entities);
      if (!shown.length) continue;

      // CRenderLayerGroup::DoRender(): the group clip, in canvas pixels
      graphics.unclip();
      if (group.clip && !this.clipGroup(group.clip, center, aspect, zoom)) continue;

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
      for (const layer of shown) {
        if (layer.type === 'tiles') drawTileLayer(graphics, layer);
        else graphics.drawQuadLayer(layer.buffer, layer.texture);
      }
    }
    graphics.unclip();
  }

  /** Clips to a group's clip rectangle. Returns false when the rectangle is off screen and the group is not drawn. */
  clipGroup(clip, center, aspect, zoom) {
    const screen = mapScreenToWorld(center.x, center.y, 100, 100, 100, 0, 0, aspect, zoom);
    const screenWidth = f(screen.right - screen.left);
    const screenHeight = f(screen.bottom - screen.top);
    const left = f(clip.x - screen.left);
    const top = f(clip.y - screen.top);
    const right = f(f(clip.x + clip.width) - screen.left);
    const bottom = f(f(clip.y + clip.height) - screen.top);
    if (right < 0 || left > screenWidth || bottom < 0 || top > screenHeight) return false;

    const { width, height } = this.graphics.canvas;
    const clipX = Math.round(f(f(left * width) / screenWidth));
    const clipY = Math.round(f(f(top * height) / screenHeight));
    this.graphics.clip(
      clipX,
      clipY,
      Math.round(f(f(right * width) / screenWidth)) - clipX,
      Math.round(f(f(bottom * height) / screenHeight)) - clipY,
    );
    return true;
  }
}

/**
 * GPU buffers of a tile layer (CRenderLayerTile::UploadTileData()): its tiles, then its edge tiles,
 * repeated past the layer's edges when the screen shows more than the layer.
 * Returns null when the layer has no tile.
 */
function createTileLayer(graphics, layer, texture) {
  const { width, height } = layer;
  const tiles = [];
  // Edge tiles: the 4 corners, then the left, right, top and bottom edges
  const corners = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const edges = {
    left: new Array(height).fill(null),
    right: new Array(height).fill(null),
    top: new Array(width).fill(null),
    bottom: new Array(width).fill(null),
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const index = layer.tiles[offset];
      if (!index) continue;
      const flags = layer.tiles[offset + 1];
      tiles.push({ x, y, index, flags });

      // Same branches as UploadTileData(): a layer 1 tile wide has no right edge, 1 tile high no bottom edge.
      const edge = (tileX, tileY, offsetX, offsetY) => ({ x: tileX, y: tileY, index, flags, offsetX, offsetY });
      if (x === 0) {
        if (y === 0) corners.topLeft = edge(0, 0, -32, -32);
        else if (y === height - 1) corners.bottomLeft = edge(0, 0, -32, 0);
        edges.left[y] = edge(0, y, -32, 0);
      } else if (x === width - 1) {
        if (y === 0) corners.topRight = edge(0, 0, 0, -32);
        else if (y === height - 1) corners.bottomRight = edge(0, 0, 0, 0);
        edges.right[y] = edge(0, y, 0, 0);
      }
      if (y === 0) edges.top[x] = edge(x, 0, 0, -32);
      else if (y === height - 1) edges.bottom[x] = edge(x, 0, 0, 0);
    }
  }
  if (!tiles.length) return null;

  // One buffer: the layer's tiles, then the corners, then each edge. starts[i]: buffer position of the i-th edge tile.
  const all = [...tiles];
  const cornerAt = {};
  for (const [name, tile] of Object.entries(corners)) {
    cornerAt[name] = tile ? all.push(tile) - 1 : -1;
  }
  const edgeStarts = {};
  for (const [name, list] of Object.entries(edges)) {
    const starts = new Uint32Array(list.length + 1);
    starts[0] = all.length;
    list.forEach((tile, i) => {
      if (tile) all.push(tile);
      starts[i + 1] = all.length;
    });
    edgeStarts[name] = starts;
  }

  const buffer = graphics.createTileBuffer(all, height, tiles.length);
  return {
    type: 'tiles',
    entities: layer.game,
    buffer,
    texture,
    color: layer.game ? [1, 1, 1, 1] : layer.color.map((channel) => channel / 255),
    width,
    height,
    cornerAt,
    edgeStarts,
  };
}

/** CRenderLayerTile::RenderTileLayer(): the visible rows, then the edge tiles repeated outside the layer. */
function drawTileLayer(graphics, layer) {
  graphics.drawTileLayer(layer.buffer, layer.texture, layer.color);

  const { left, top, right, bottom } = graphics.screen;
  const x0 = Math.floor(left / 32);
  const y0 = Math.floor(top / 32);
  const x1 = Math.ceil(right / 32);
  const y1 = Math.ceil(bottom / 32);
  const { width, height } = layer;
  if (x1 <= width && y1 <= height && x0 >= 0 && y0 >= 0) return;

  // CRenderLayerTile::RenderTileBorder()
  const draw = (first, count, offsetX, offsetY, scaleX, scaleY) =>
    graphics.drawBorderTiles(
      layer.buffer,
      layer.texture,
      layer.color,
      first,
      count,
      [offsetX * 32, offsetY * 32],
      [scaleX, scaleY],
    );
  const corner = (name, offsetX, offsetY, scaleX, scaleY) => {
    if (layer.cornerAt[name] >= 0) draw(layer.cornerAt[name], 1, offsetX, offsetY, scaleX, scaleY);
  };
  if (x0 < 0) {
    if (y0 < 0) corner('topLeft', 0, 0, -x0, -y0);
    if (y1 > height) corner('bottomLeft', 0, height, -x0, y1 - height);
  }
  if (x1 > width) {
    if (y0 < 0) corner('topRight', width, 0, x1 - width, -y0);
    if (y1 > height) corner('bottomRight', width, height, x1 - width, y1 - height);
  }

  const edge = (name, from, to, offsetX, offsetY, scaleX, scaleY) => {
    const starts = layer.edgeStarts[name];
    draw(starts[from], starts[to] - starts[from], offsetX, offsetY, scaleX, scaleY);
  };
  const rowFrom = Math.max(0, y0);
  const rowTo = Math.min(height, y1);
  const columnFrom = Math.max(0, x0);
  const columnTo = Math.min(width, x1);
  if (rowFrom < height && rowTo > 0) {
    if (x1 > width) edge('right', rowFrom, rowTo, width, 0, x1 - width, 1);
    if (x0 < 0) edge('left', rowFrom, rowTo, 0, 0, -x0, 1);
  }
  if (columnFrom < width && columnTo > 0) {
    if (y0 < 0) edge('top', columnFrom, columnTo, 0, 0, 1, -y0);
    if (y1 > height) edge('bottom', columnFrom, columnTo, 0, height, 1, y1 - height);
  }
}
