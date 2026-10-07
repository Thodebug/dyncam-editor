/**
 * Reader for DDNet .map files (src/engine/shared/datafile.cpp, src/game/mapitems.h).
 *
 * A map is a datafile: a header, a list of items (groups, layers, images...) made of 32-bit integers,
 * and blocks of zlib-compressed data (tiles, quads, image names).
 */

const ITEM_TYPE_IMAGE = 2;
const ITEM_TYPE_GROUP = 4;
const ITEM_TYPE_LAYER = 5;

const LAYER_TYPE_TILES = 2;
const LAYER_TYPE_QUADS = 3;

const LAYER_FLAG_DETAIL = 1;
const TILES_LAYER_FLAG_GAME = 1;

const HEADER_SIZE = 36;

/** Points and texture coordinates of quads are 22.10 fixed point numbers. */
const fixedToFloat = (value) => value / 1024;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The raw items and data blocks of a datafile. */
class Datafile {
  constructor(buffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== 'DATA' && magic !== 'ATAD') throw new Error('Not a DDNet map file');
    const int = (offset) => view.getInt32(offset, true);

    const version = int(4);
    if (version !== 3 && version !== 4) throw new Error(`Unsupported map file version ${version}`);
    const itemTypeCount = int(16);
    const itemCount = int(20);
    const dataCount = int(24);
    const itemsSize = int(28);
    const dataSize = int(32);

    let offset = HEADER_SIZE;
    this.itemTypes = [];
    for (let i = 0; i < itemTypeCount; i++, offset += 12) {
      this.itemTypes.push({ type: int(offset), start: int(offset + 4), count: int(offset + 8) });
    }
    const itemOffsets = [];
    for (let i = 0; i < itemCount; i++, offset += 4) itemOffsets.push(int(offset));
    const dataOffsets = [];
    for (let i = 0; i < dataCount; i++, offset += 4) dataOffsets.push(int(offset));
    // Version 4 stores the uncompressed size of each data block; version 3 data is not compressed.
    this.compressed = version === 4;
    if (this.compressed) offset += dataCount * 4;

    const itemsStart = offset;
    const dataStart = itemsStart + itemsSize;

    // Each item: type and id in one integer, size in bytes, then the item's integers.
    this.items = itemOffsets.map((itemOffset) => {
      const start = itemsStart + itemOffset;
      const size = int(start + 4);
      return { typeAndId: int(start) >>> 0, values: new Int32Array(buffer.slice(start + 8, start + 8 + size)) };
    });

    this.data = dataOffsets.map((dataOffset, index) => {
      const end = index + 1 < dataCount ? dataOffsets[index + 1] : dataSize;
      return new Uint8Array(buffer, dataStart + dataOffset, end - dataOffset);
    });
  }

  /** Item values of every item of a type, in order. */
  itemsOfType(type) {
    const itemType = this.itemTypes.find((entry) => entry.type === type);
    if (!itemType) return [];
    return this.items.slice(itemType.start, itemType.start + itemType.count).map((item) => item.values);
  }

  async dataBlock(index) {
    return this.compressed ? inflate(this.data[index]) : this.data[index].slice();
  }

  async string(index) {
    const bytes = await this.dataBlock(index);
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end >= 0 ? bytes.subarray(0, end) : bytes);
  }
}

/** Expands tiles saved with CTile::m_Skip (tiles layer version 4 and later): each tile repeats m_Skip more times. */
function extractTiles(packed, count) {
  const tiles = new Uint8Array(count * 4);
  let target = 0;
  for (let source = 0; source < packed.length && target < count; source += 4) {
    for (let repeat = 0; repeat <= packed[source + 2] && target < count; repeat++, target++) {
      tiles[target * 4] = packed[source];
      tiles[target * 4 + 1] = packed[source + 1];
    }
  }
  return tiles;
}

/** CQuad: 5 points (4 corners and the rotation center), 4 colors, 4 texture coordinates, then envelopes. */
function readQuads(bytes, count) {
  const values = new Int32Array(bytes.buffer, bytes.byteOffset, count * 38);
  const quads = [];
  for (let i = 0; i < count; i++) {
    const base = i * 38;
    const points = [];
    for (let p = 0; p < 5; p++)
      points.push({ x: fixedToFloat(values[base + p * 2]), y: fixedToFloat(values[base + p * 2 + 1]) });
    const colors = [];
    for (let c = 0; c < 4; c++) colors.push([0, 1, 2, 3].map((channel) => values[base + 10 + c * 4 + channel]));
    const texcoords = [];
    for (let t = 0; t < 4; t++) {
      texcoords.push({ u: fixedToFloat(values[base + 26 + t * 2]), v: fixedToFloat(values[base + 26 + t * 2 + 1]) });
    }
    quads.push({ points, colors, texcoords, positionEnvelope: values[base + 34], colorEnvelope: values[base + 36] });
  }
  return quads;
}

/**
 * Reads a map. Returns:
 * images: [{ name, external }], with { width, height, data } (RGBA bytes) for images embedded in the map
 * groups: [{ offsetX, offsetY, parallaxX, parallaxY, clip, layers }]
 * layer: { type: 'tiles', game, detail, width, height, color, image, tiles } where tiles holds
 *        (index, flags, skip, 0) for each tile, or { type: 'quads', detail, image, quads }
 */
export async function readMap(buffer) {
  const file = new Datafile(buffer);

  const images = await Promise.all(
    // CMapItemImage: version, width, height, external, name, data (RGBA bytes for embedded images)
    file.itemsOfType(ITEM_TYPE_IMAGE).map(async (item) => {
      const image = { external: item[3] !== 0, name: await file.string(item[4]) };
      if (!image.external)
        Object.assign(image, { width: item[1], height: item[2], data: await file.dataBlock(item[5]) });
      return image;
    }),
  );

  const layerItems = file.itemsOfType(ITEM_TYPE_LAYER);
  const groups = await Promise.all(
    file.itemsOfType(ITEM_TYPE_GROUP).map(async (item) => {
      const [version, offsetX, offsetY, parallaxX, parallaxY, startLayer, layerCount] = item;
      const clip = version >= 2 && item[7] ? { x: item[8], y: item[9], width: item[10], height: item[11] } : null;
      const layers = [];
      for (const layerItem of layerItems.slice(startLayer, startLayer + layerCount)) {
        const type = layerItem[1];
        const detail = (layerItem[2] & LAYER_FLAG_DETAIL) !== 0;
        // CMapItemLayerTilemap: after CMapItemLayer (3 values), version, width, height, flags, color (4), color envelope (2), image, data
        if (type === LAYER_TYPE_TILES) {
          const [tilesVersion, width, height, flags, red, green, blue, alpha] = layerItem.slice(3, 11);
          const packed = await file.dataBlock(layerItem[14]);
          const tiles = tilesVersion >= 4 ? extractTiles(packed, width * height) : packed;
          layers.push({
            type: 'tiles',
            game: (flags & TILES_LAYER_FLAG_GAME) !== 0,
            detail,
            width,
            height,
            color: [red, green, blue, alpha],
            image: layerItem[13],
            tiles,
          });
        } else if (type === LAYER_TYPE_QUADS) {
          // CMapItemLayerQuads: after CMapItemLayer, version, number of quads, data, image
          const count = layerItem[4];
          const quads = count > 0 ? readQuads(await file.dataBlock(layerItem[5]), count) : [];
          layers.push({ type: 'quads', detail, image: layerItem[6], quads });
        }
      }
      return { offsetX, offsetY, parallaxX, parallaxY, clip, layers };
    }),
  );

  return { images, groups };
}
