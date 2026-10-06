# Credits

Dyncam editor is not affiliated with DDNet or Teeworlds. It reuses their code and graphics under the licenses below.

## Code ported from DDNet

The cursor, camera, collision, laser and rendering logic in `js/` is a JavaScript port of parts of the
[DDNet](https://github.com/ddnet/ddnet) source code, modified to run in a browser:

- `src/game/client/components/controls.cpp` and `camera.cpp`: cursor limits and dynamic camera
- `src/game/collision.cpp`: line intersection and point movement
- `src/game/server/entities/laser.cpp`: laser bounces
- `src/game/client/render.cpp`, `components/players.cpp`, `components/items.cpp`, `components/hud.cpp`: tee, hook, laser and cursor rendering
- `src/engine/shared/config_variables.h`: ranges, defaults and descriptions of the console variables

Teeworlds Copyright (C) 2007-2014 Magnus Auvinen,
DDRace Copyright (C) 2010-2011 Shereef Marzouk,
DDNet Copyright (C) Dennis Felsing.
Licensed under the [zlib license](https://github.com/ddnet/ddnet/blob/master/license.txt).

## Graphics

| Files | Source | License |
|---|---|---|
| `assets/map/*.webp`, `assets/map/collision.png` | Rendered from the map `data/maps/ctf5.map` of Teeworlds / DDNet | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `assets/sprites/game.png`, `assets/sprites/particles.png` | `data/game.png` and `data/particles.png` of DDNet | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `assets/sprites/skin-default.png` | `data/skins/default.png` of DDNet, Copyright Magnus Auvinen | zlib |

The map images are screenshots of the ctf5 layers taken in the DDNet client, separated by layer group.
The sky is drawn from the colors of the ctf5 sky quad.
The collision image has one pixel per tile of the ctf5 game layer (white = solid, grey = unhookable).
These derived images are shared under the same CC BY-SA 3.0 license.

## Fonts

| File | Source | License |
|---|---|---|
| `assets/fonts/dejavu-sans.woff2` | Subset of [DejaVu Sans](https://dejavu-fonts.github.io/). Fonts are (c) Bitstream, DejaVu changes are in the public domain | [Bitstream Vera license](https://dejavu-fonts.github.io/License.html) |
| `assets/fonts/icons.woff2` | Subset of Font Awesome Free 6 Solid, Copyright (c) 2023 Fonticons, Inc. (https://fontawesome.com), with Reserved Font Name "Font Awesome". Renamed "Dyncam Icons" | [SIL Open Font License 1.1](https://openfontlicense.org) |
