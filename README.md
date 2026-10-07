# Dyncam editor

[![Checks](https://github.com/Thodebug/dyncam-editor/actions/workflows/checks.yml/badge.svg)](https://github.com/Thodebug/dyncam-editor/actions/workflows/checks.yml)

**Open the editor: https://thodebug.github.io/dyncam-editor/**

Set the [DDNet](https://ddnet.org) camera settings on the real game view, then copy the console commands.

DDNet's menu only has two camera options : Dynamic Camera and Smooth Dynamic Camera.
Every other setting can only be changed in the console.
This editor shows what each value does exactly as the game draws them.

## Features

- The game view drawn from the game's own files and shaders: maps, textures, tee, weapons and cursor
- 13 vanilla maps: ctf1 to ctf7, dm1, dm2, dm6 to dm9
- 16:9, 16:10, 4:3 and 21:9 screens
- Every camera setting** with the game's ranges and defaults
- Capture mouse: the cursor moves with your in-game sensitivity
- Show distances: visual representation of the different camera options (deadzone, camera offset, etc.)
- Starting values read from the game console or from `settings_ddnet.cfg`
- Output as console commands, a share link or an image
- Last values kept in the browser

## Apply the commands in game

In the DDNet's client, press F1 to open the console, paste with Ctrl+V, then press Enter.

## Run locally

Serve the folder with any static web server, for example:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. There is no build step: the files of the repository are the site.

## Project structure

```
index.html              page structure
style.css               DDNet menu look and page layout
js/
  main.js               loads the assets and connects the modules
  loading.js            downloads with progress, loading screen
  map-file.js           reader for DDNet .map files
  graphics.js           WebGL 2 drawing with the state and shaders of the DDNet client
  map-renderer.js       tile and quad layers with their parallax, clipping and edges
  maps.js               the maps, their images and where the tee stands
  settings.js           list of console variables (ranges, defaults, descriptions)
  config-store.js       current values, commands, share link, browser storage
  camera.js             cursor limits and camera smoothing
  collision.js          map collision in 32-bit floats
  player.js             the tee: weapons, attack animations, blinking
  laser.js              laser path and timing
  hook.js               hook flight, grab and retraction
  tee-renderer.js       tee, weapon, hook, laser and cursor sprites
  game-view.js          game view: draw order, camera, distance circles
  pointer.js            aiming, mouse capture, buttons and wheel
  settings-panel.js     setting rows and their notes
  commands-panel.js     commands list, copy, share, load from game, reset
  config-help.js        "Where is settings_ddnet.cfg?" popup
  clipboard.js          copy to the clipboard
  snapshot.js           image of the view with the commands
  tooltip.js            tooltips
assets/
  map/                  the maps (data/maps of DDNet)
  mapres/               images used by the maps (data/mapres of DDNet)
  entities/             DDNet's entities image
  sprites/              tee skin, weapons, particles, menu background fade
  fonts/                DejaVu Sans and icons
  help/                 capture of the DDNet settings menu
.github/workflows/     checks, deployment to GitHub Pages, releases
eslint.config.js        code checks (development only)
.prettierrc.json        code format (development only)
```

The formulas follow the DDNet source code. Comments in the code name the DDNet function each part comes from.

## Limits
- The view needs WebGL 2
- Zoom x1 only

## License

The code is released under the zlib license (see [LICENSE](LICENSE)).
The graphics and fonts come from DDNet, Teeworlds and third parties and keep their own licenses
(see [CREDITS.md](CREDITS.md)).
