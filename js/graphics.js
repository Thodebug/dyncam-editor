/**
 * WebGL 2 drawing with the state and shaders of the DDNet client's OpenGL 3 backend
 * (src/engine/client/backend/opengl/backend_opengl3.cpp, data/shader/*):
 * - textures are not premultiplied and blend with GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA
 * - mipmapped textures use linear filtering between mipmap levels with a LOD bias of −0.5 (gfx_gl_texture_lod_bias)
 * - tile layers sample a 2D array texture: the tileset split into 16 × 16 tiles, one layer per tile
 * - positions go through an orthographic projection of the screen rectangle (MapScreen())
 */

const LOD_BIAS = -0.5;

const VERTEX_PRIMITIVE = `#version 300 es
layout (location = 0) in vec2 inVertex;
layout (location = 1) in vec2 inVertexTexCoord;
layout (location = 2) in vec4 inVertexColor;
uniform mat4x2 gPos;
out vec2 texCoord;
out vec4 vertColor;
void main() {
  gl_Position = vec4(gPos * vec4(inVertex, 0.0, 1.0), 0.0, 1.0);
  texCoord = inVertexTexCoord;
  vertColor = inVertexColor;
}`;

const FRAGMENT_PRIMITIVE = `#version 300 es
precision highp float;
uniform sampler2D gTextureSampler;
uniform bool gTextured;
uniform float gLodBias;
in vec2 texCoord;
in vec4 vertColor;
out vec4 FragClr;
void main() {
  FragClr = gTextured ? texture(gTextureSampler, texCoord, gLodBias) * vertColor : vertColor;
}`;

const VERTEX_TILE = `#version 300 es
layout (location = 0) in vec2 inVertex;
layout (location = 1) in uvec4 inVertexTexCoord;
uniform mat4x2 gPos;
out vec3 TexCoord;
void main() {
  gl_Position = vec4(gPos * vec4(inVertex, 0.0, 1.0), 0.0, 1.0);
  TexCoord = vec3(inVertexTexCoord.xyz);
}`;

const FRAGMENT_TILE = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray gTextureSampler;
uniform vec4 gVertColor;
in vec3 TexCoord;
out vec4 FragClr;
void main() {
  FragClr = texture(gTextureSampler, TexCoord, ${LOD_BIAS.toFixed(1)}) * gVertColor;
}`;

/**
 * Tiles repeated past the edge of a tile layer (data/shader/tile_border.vert and .frag):
 * the edge tile is stretched by gScale and moved by gOffset, its texture repeats with fract().
 * textureGrad() keeps the mipmap level of the unrepeated coordinates; the LOD bias scales the gradients.
 */
const VERTEX_TILE_BORDER = `#version 300 es
layout (location = 0) in vec2 inVertex;
layout (location = 1) in uvec4 inVertexTexCoord;
uniform mat4x2 gPos;
uniform vec2 gOffset;
uniform vec2 gScale;
centroid out vec3 TexCoord;
void main() {
  vec2 VertexPos = (inVertex * gScale) + gOffset;
  gl_Position = vec4(gPos * vec4(VertexPos, 0.0, 1.0), 0.0, 1.0);
  vec2 TexScale = gScale;
  if (float(inVertexTexCoord.w) > 0.0) TexScale = gScale.yx;
  TexCoord = vec3(vec2(inVertexTexCoord.xy) * TexScale, float(inVertexTexCoord.z));
}`;

const FRAGMENT_TILE_BORDER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray gTextureSampler;
uniform vec4 gVertColor;
centroid in vec3 TexCoord;
out vec4 FragClr;
void main() {
  vec3 realTexCoords = vec3(fract(TexCoord.xy), TexCoord.z);
  float bias = exp2(${LOD_BIAS.toFixed(1)});
  vec2 dx = dFdx(TexCoord.xy) * bias;
  vec2 dy = dFdy(TexCoord.xy) * bias;
  FragClr = textureGrad(gTextureSampler, realTexCoords, dx, dy) * gVertColor;
}`;

/** Map quads: position and rotation center, color, texture coordinates (data/shader/quad.vert, grouped). */
const VERTEX_QUAD = `#version 300 es
layout (location = 0) in vec4 inVertex;
layout (location = 1) in vec4 inColor;
layout (location = 2) in vec2 inVertexTexCoord;
uniform mat4x2 gPos;
out vec4 QuadColor;
out vec2 TexCoord;
void main() {
  gl_Position = vec4(gPos * vec4(inVertex.xy, 0.0, 1.0), 0.0, 1.0);
  QuadColor = inColor;
  TexCoord = inVertexTexCoord;
}`;

const FRAGMENT_QUAD = `#version 300 es
precision highp float;
uniform sampler2D gTextureSampler;
uniform bool gTextured;
uniform vec4 gVertColor;
in vec4 QuadColor;
in vec2 TexCoord;
out vec4 FragClr;
void main() {
  vec4 color = QuadColor * gVertColor;
  FragClr = gTextured ? texture(gTextureSampler, TexCoord, ${LOD_BIAS.toFixed(1)}) * color : color;
}`;

/**
 * Circle line of the editor's distance circles, drawn on a square around it: anti-aliased,
 * solid or dashed. Dashes start at angle 0 and run clockwise, like CanvasRenderingContext2D.setLineDash().
 */
const VERTEX_RING = `#version 300 es
layout (location = 0) in vec2 inVertex;
uniform mat4x2 gPos;
out vec2 Position;
void main() {
  gl_Position = vec4(gPos * vec4(inVertex, 0.0, 1.0), 0.0, 1.0);
  Position = inVertex;
}`;

const FRAGMENT_RING = `#version 300 es
precision highp float;
uniform vec2 gCenter;
uniform float gRadius;
uniform float gWidth;
uniform vec2 gDash;
uniform vec4 gColor;
in vec2 Position;
out vec4 FragClr;
void main() {
  vec2 offset = Position - gCenter;
  float coverage = clamp(gWidth * 0.5 - abs(length(offset) - gRadius) + 0.5, 0.0, 1.0);
  if (gDash.x > 0.0) {
    float angle = atan(offset.y, offset.x);
    if (angle < 0.0) angle += 6.28318530718;
    float along = mod(angle * gRadius, gDash.x + gDash.y);
    coverage *= clamp(gDash.x - along + 0.5, 0.0, 1.0) * clamp(along + 0.5, 0.0, 1.0);
  }
  FragClr = vec4(gColor.rgb, gColor.a * coverage);
}`;

/** Floats per vertex of drawPrimitives(): x, y, u, v, r, g, b, a */
export const PRIMITIVE_STRIDE = 8;

export class WebGLUnavailableError extends Error {}

/** Color channel as stored by CGraphics_Threaded: 0..255, rounded to the nearest. */
export function colorByte(value) {
  return Math.floor(Math.min(Math.max(value, 0), 1) * 255 + 0.5);
}

export class Graphics {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new WebGLUnavailableError('WebGL 2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.init();
  }

  /** Creates the programs and buffers. Called again after the context is restored. */
  init() {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.enable(gl.BLEND);
    this.setBlend('normal');

    this.programs = {
      primitive: this.createProgram(VERTEX_PRIMITIVE, FRAGMENT_PRIMITIVE),
      tile: this.createProgram(VERTEX_TILE, FRAGMENT_TILE),
      tileBorder: this.createProgram(VERTEX_TILE_BORDER, FRAGMENT_TILE_BORDER),
      quad: this.createProgram(VERTEX_QUAD, FRAGMENT_QUAD),
      ring: this.createProgram(VERTEX_RING, FRAGMENT_RING),
    };

    // Stream buffer for primitives drawn every frame
    this.primitiveArray = gl.createVertexArray();
    this.primitiveBuffer = gl.createBuffer();
    gl.bindVertexArray(this.primitiveArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
    const stride = PRIMITIVE_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.bindVertexArray(null);
    this.projection = new Float32Array(8);

    // Primitives are queued and sent to the GPU in one upload when the state changes (flush()).
    this.batch = new Float32Array(1024 * PRIMITIVE_STRIDE);
    this.ringVertices = new Float32Array(6 * PRIMITIVE_STRIDE);
    this.batchCount = 0;
    this.batchDraws = [];
  }

  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) ?? 0;
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }

  /** 'normal': GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA. 'premultiplied': for textures uploaded premultiplied. */
  setBlend(mode) {
    this.flush();
    const gl = this.gl;
    if (mode === 'premultiplied') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /* ---------- Textures ---------- */

  /** The RGBA bytes of an image, exactly as stored in the file (not premultiplied, no color conversion). */
  readImagePixels(image) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const data = new Uint8Array(image.width * image.height * 4);
    gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return { width: image.width, height: image.height, data };
  }

  /**
   * Texture from RGBA pixels { width, height, data }, like CCommandProcessorFragment_OpenGL3_3::TextureCreate().
   * mipmaps: GL_LINEAR_MIPMAP_LINEAR with generated mipmaps, else GL_LINEAR. wrap: 'repeat' or 'clamp'.
   */
  createTexture(pixels, { mipmaps = true, wrap = 'clamp', premultiplied = false } = {}) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (pixels.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixels.width, pixels.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    if (premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    const wrapMode = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    return { texture, width: pixels.width, height: pixels.height, mipmaps };
  }

  deleteTexture(texture) {
    this.gl.deleteTexture(texture.texture);
  }

  /** Frees a buffer made by createTileBuffer() or createQuadBuffer(). */
  deleteBuffer(buffer) {
    const gl = this.gl;
    gl.deleteVertexArray(buffer.array);
    for (const glBuffer of buffer.glBuffers) gl.deleteBuffer(glBuffer);
  }

  /** The tileset of a tile layer as a 2D array texture of 256 tiles (Texture2DTo3D()), with mipmaps. */
  createTileArrayTexture(pixels) {
    const gl = this.gl;
    const tileWidth = pixels.width / 16;
    const tileHeight = pixels.height / 16;
    const rowBytes = tileWidth * 4;
    const layers = new Uint8Array(pixels.data.length);
    for (let tileY = 0; tileY < 16; tileY++) {
      for (let tileX = 0; tileX < 16; tileX++) {
        const layer = tileY * 16 + tileX;
        for (let y = 0; y < tileHeight; y++) {
          const source = ((tileY * tileHeight + y) * pixels.width + tileX * tileWidth) * 4;
          const target = (layer * tileHeight + y) * rowBytes;
          layers.set(pixels.data.subarray(source, source + rowBytes), target);
        }
      }
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, tileWidth, tileHeight, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.MIRRORED_REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    return { texture, array: true };
  }

  /* ---------- Screen ---------- */

  /** Matches the drawing buffer to the canvas size. */
  setViewport(width, height) {
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * IGraphics::ClipEnable(): only the canvas pixels from (x, y), `width` × `height`, counted from the top left, are drawn.
   * The rectangle is cut to the canvas like CGraphics_Threaded::ClipEnable().
   */
  clip(x, y, width, height) {
    this.flush();
    const gl = this.gl;
    const screenWidth = gl.drawingBufferWidth;
    const screenHeight = gl.drawingBufferHeight;
    if (x < 0) width += x;
    if (y < 0) height += y;
    const clamp = (value, max) => Math.min(Math.max(value, 0), max);
    x = clamp(x, screenWidth);
    y = clamp(y, screenHeight);
    width = clamp(width, screenWidth - x);
    height = clamp(height, screenHeight - y);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, screenHeight - (y + height), width, height);
  }

  /** IGraphics::ClipDisable() */
  unclip() {
    this.flush();
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  clear(red, green, blue) {
    const gl = this.gl;
    gl.clearColor(red, green, blue, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** IGraphics::MapScreen(): the world rectangle shown on the whole canvas, as the orthographic matrix of SetState(). */
  mapScreen(left, top, right, bottom) {
    this.flush();
    const f = Math.fround;
    const p = this.projection;
    // Column-major mat4x2 (OpenGL receives the row-major matrix transposed)
    p[0] = f(2 / f(right - left));
    p[1] = 0;
    p[2] = 0;
    p[3] = f(2 / f(top - bottom));
    p[4] = 0;
    p[5] = 0;
    p[6] = f(-f(f(right + left) / f(right - left)));
    p[7] = f(-f(f(top + bottom) / f(top - bottom)));
    this.screen = { left, top, right, bottom };
  }

  useProgram(program) {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.uniformMatrix4x2fv(program.uniforms.gPos, false, this.projection);
  }

  bindTexture(target, texture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(target, texture);
  }

  /* ---------- Drawing ---------- */

  /**
   * Triangles from a Float32Array of vertices (PRIMITIVE_STRIDE floats each: x, y, u, v, r, g, b, a with colors 0..1),
   * textured when `texture` is given. They are drawn in order at the next flush().
   */
  drawPrimitives(vertices, count, texture = null) {
    const size = count * PRIMITIVE_STRIDE;
    const start = this.batchCount * PRIMITIVE_STRIDE;
    if (start + size > this.batch.length) {
      const larger = new Float32Array(Math.max(this.batch.length * 2, start + size));
      larger.set(this.batch.subarray(0, start));
      this.batch = larger;
    }
    this.batch.set(vertices.subarray(0, size), start);
    const last = this.batchDraws[this.batchDraws.length - 1];
    if (last && last.texture === texture) last.count += count;
    else this.batchDraws.push({ texture, first: this.batchCount, count });
    this.batchCount += count;
  }

  /** Draws the queued primitives. */
  flush() {
    if (!this.batchCount) return;
    const gl = this.gl;
    const program = this.programs.primitive;
    this.useProgram(program);
    gl.uniform1i(program.uniforms.gTextureSampler, 0);
    gl.bindVertexArray(this.primitiveArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.subarray(0, this.batchCount * PRIMITIVE_STRIDE), gl.STREAM_DRAW);
    for (const draw of this.batchDraws) {
      gl.uniform1i(program.uniforms.gTextured, draw.texture ? 1 : 0);
      gl.uniform1f(program.uniforms.gLodBias, draw.texture?.mipmaps ? LOD_BIAS : 0);
      if (draw.texture) this.bindTexture(gl.TEXTURE_2D, draw.texture.texture);
      gl.drawArrays(gl.TRIANGLES, draw.first, draw.count);
    }
    gl.bindVertexArray(null);
    this.batchCount = 0;
    this.batchDraws.length = 0;
  }

  /**
   * Static tile layer buffers: `tiles` is [{ x, y, index, flags }] in tiles, row by row, for a layer `height` tiles high.
   * Each tile is a quad of 32 units, with texture coordinates turned by the tile flags
   * (FillTmpTile() in src/game/map/render_layer.cpp). A tile can have offsetX and offsetY in units,
   * like the edge tiles of AddTile() used for the layer borders.
   * Only the first `rowTileCount` tiles are drawn by drawTileLayer(); the others are drawn with drawBorderTiles().
   */
  createTileBuffer(tiles, height, rowTileCount = tiles.length) {
    const gl = this.gl;
    const positions = new Float32Array(tiles.length * 8);
    const texcoords = new Uint8Array(tiles.length * 16);
    const indices = new Uint32Array(tiles.length * 6);
    tiles.forEach((tile, i) => {
      const left = tile.x * 32 + (tile.offsetX ?? 0);
      const top = tile.y * 32 + (tile.offsetY ?? 0);
      // Top left, top right, bottom right, bottom left
      positions.set([left, top, left + 32, top, left + 32, top + 32, left, top + 32], i * 8);
      const { texX, texY } = tileTexCoords(tile.flags);
      const rotated = (tile.flags & TILEFLAG_ROTATE) !== 0 ? 1 : 0;
      for (let corner = 0; corner < 4; corner++) {
        texcoords.set([texX[corner], texY[corner], tile.index, rotated], i * 16 + corner * 4);
      }
      indices.set(
        [0, 1, 2, 0, 2, 3].map((index) => i * 4 + index),
        i * 6,
      );
    });
    // rowStarts[y]: number of tiles before row y
    const rowStarts = new Uint32Array(height + 1);
    for (const tile of tiles.slice(0, rowTileCount)) rowStarts[tile.y + 1]++;
    for (let y = 0; y < height; y++) rowStarts[y + 1] += rowStarts[y];

    const array = gl.createVertexArray();
    gl.bindVertexArray(array);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_BYTE, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { array, rowStarts, height, glBuffers: [positionBuffer, texcoordBuffer, indexBuffer] };
  }

  /**
   * CCommandProcessorFragment_OpenGL3_3::Cmd_RenderTileLayer() for the rows the screen shows
   * (CRenderLayerTile::RenderTileLayer()).
   */
  drawTileLayer(buffer, texture, color) {
    this.flush();
    const { top, bottom } = this.screen;
    const firstRow = Math.min(Math.max(Math.floor(top / 32), 0), buffer.height);
    const endRow = Math.min(Math.max(Math.ceil(bottom / 32), 0), buffer.height);
    const first = buffer.rowStarts[firstRow];
    const count = buffer.rowStarts[endRow] - first;
    if (count <= 0) return;
    const gl = this.gl;
    const program = this.programs.tile;
    this.useProgram(program);
    this.bindTexture(gl.TEXTURE_2D_ARRAY, texture.texture);
    gl.uniform1i(program.uniforms.gTextureSampler, 0);
    gl.uniform4fv(program.uniforms.gVertColor, color);
    gl.bindVertexArray(buffer.array);
    gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_INT, first * 6 * 4);
    gl.bindVertexArray(null);
  }

  /**
   * CCommandProcessorFragment_OpenGL3_3::Cmd_RenderBorderTile(): `count` tiles of a tile buffer from tile `first`,
   * each stretched by scale [x, y] and moved by offset [x, y] in units.
   */
  drawBorderTiles(buffer, texture, color, first, count, offset, scale) {
    if (count <= 0) return;
    this.flush();
    const gl = this.gl;
    const program = this.programs.tileBorder;
    this.useProgram(program);
    this.bindTexture(gl.TEXTURE_2D_ARRAY, texture.texture);
    gl.uniform1i(program.uniforms.gTextureSampler, 0);
    gl.uniform4fv(program.uniforms.gVertColor, color);
    gl.uniform2fv(program.uniforms.gOffset, offset);
    gl.uniform2fv(program.uniforms.gScale, scale);
    gl.bindVertexArray(buffer.array);
    gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_INT, first * 6 * 4);
    gl.bindVertexArray(null);
  }

  /**
   * Static quad layer buffers (CRenderLayerQuads::Init()): each quad's corners in the order 0, 1, 3, 2,
   * so that the triangles are (0, 1, 3) and (0, 3, 2) like the game's quad index buffer.
   */
  createQuadBuffer(quads) {
    const gl = this.gl;
    // x, y, center x, center y, then r, g, b, a as bytes, then u, v
    const strideBytes = 4 * 4 + 4 + 2 * 4;
    const data = new ArrayBuffer(quads.length * 4 * strideBytes);
    const floats = new Float32Array(data);
    const bytes = new Uint8Array(data);
    const indices = new Uint32Array(quads.length * 6);
    quads.forEach((quad, i) => {
      [0, 1, 3, 2].forEach((point, corner) => {
        const offset = (i * 4 + corner) * strideBytes;
        floats.set([quad.points[point].x, quad.points[point].y, quad.points[4].x, quad.points[4].y], offset / 4);
        bytes.set(quad.colors[point], offset + 16);
        floats.set([quad.texcoords[point].u, quad.texcoords[point].v], (offset + 20) / 4);
      });
      indices.set(
        [0, 1, 2, 0, 2, 3].map((index) => i * 4 + index),
        i * 6,
      );
    });

    const array = gl.createVertexArray();
    gl.bindVertexArray(array);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, strideBytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, strideBytes, 16);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, strideBytes, 20);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { array, count: indices.length, glBuffers: [vertexBuffer, indexBuffer] };
  }

  /** CCommandProcessorFragment_OpenGL3_3::Cmd_RenderQuadLayer() for quads without envelopes. */
  drawQuadLayer(buffer, texture) {
    this.flush();
    const gl = this.gl;
    const program = this.programs.quad;
    this.useProgram(program);
    gl.uniform1i(program.uniforms.gTextured, texture ? 1 : 0);
    if (texture) {
      this.bindTexture(gl.TEXTURE_2D, texture.texture);
      gl.uniform1i(program.uniforms.gTextureSampler, 0);
    }
    gl.uniform4fv(program.uniforms.gVertColor, [1, 1, 1, 1]);
    gl.bindVertexArray(buffer.array);
    gl.drawElements(gl.TRIANGLES, buffer.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * A circle line centered on (x, y), in the units of the mapped screen: `width` thick, color RGBA from 0 to 1,
   * dash [on, off] lengths along the circle, or null for a solid line.
   */
  drawRing(x, y, radius, width, color, dash = null) {
    this.flush();
    const gl = this.gl;
    const program = this.programs.ring;
    this.useProgram(program);
    gl.uniform2f(program.uniforms.gCenter, x, y);
    gl.uniform1f(program.uniforms.gRadius, radius);
    gl.uniform1f(program.uniforms.gWidth, width);
    gl.uniform2f(program.uniforms.gDash, dash ? dash[0] : 0, dash ? dash[1] : 0);
    gl.uniform4fv(program.uniforms.gColor, color);

    const extent = radius + width + 1;
    const [left, top, right, bottom] = [x - extent, y - extent, x + extent, y + extent];
    const square = this.ringVertices;
    [left, top, right, top, right, bottom, left, top, right, bottom, left, bottom].forEach((value, i) => {
      square[Math.floor(i / 2) * PRIMITIVE_STRIDE + (i % 2)] = value;
    });
    gl.bindVertexArray(this.primitiveArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, square, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}

const TILEFLAG_XFLIP = 1;
const TILEFLAG_YFLIP = 2;
const TILEFLAG_ROTATE = 8;

/** CalculateTexCoords() of render_layer.cpp: texture coordinates of the corners top left, top right, bottom right, bottom left. */
function tileTexCoords(flags) {
  const rotate = (values, by) => values.slice(by).concat(values.slice(0, by));
  let texX = [0, 1, 1, 0];
  let texY = [0, 0, 1, 1];
  if (flags & TILEFLAG_XFLIP) texX = rotate(texX, 2);
  if (flags & TILEFLAG_YFLIP) texY = rotate(texY, 2);
  if (flags & TILEFLAG_ROTATE) {
    texX = rotate(texX, 3);
    texY = rotate(texY, 3);
  }
  return { texX, texY };
}
