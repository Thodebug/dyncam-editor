# Dyncam editor

[![Checks](https://github.com/Thodebug/dyncam-editor/actions/workflows/checks.yml/badge.svg)](https://github.com/Thodebug/dyncam-editor/actions/workflows/checks.yml)

**Open the editor: https://thodebug.github.io/dyncam-editor/**

Set the [DDNet](https://ddnet.org) camera settings on the real game view, then copy the console commands.

DDNet's menu only has two checkboxes for the camera (Dynamic Camera and Smooth Dynamic Camera). Every other
setting, like the cursor distance, the deadzone or the follow factor, can only be changed in the console.
This editor shows what each value does, on the Teeworlds maps shipped with DDNet, exactly as the game draws them.

## Features

- The real game view: the map files drawn with WebGL like the DDNet client draws them (same shaders, texture
  filtering, parallax, group clipping, layer edges and layer order), the default tee, its weapon and the cursor,
  at zoom 1, on a 16:9, 16:10, 4:3 or 21:9 screen.
- 13 maps: ctf1 to ctf7, dm1, dm2, dm6 to dm9. The map is kept in share links.
- **Entities**: only the game tiles, with DDNet's entities image, like the game's entities view.
- Every `cl_dyncam_*` and `cl_mouse_*` setting, with the game's ranges, defaults and descriptions.
- The `cl_dyncam` switch shows either camera mode, `cl_dyncam 1` or `cl_dyncam 0`.
- Camera smoothing (`cl_dyncam_smoothness`, `cl_dyncam_stabilizing`) computed like the game.
- **Capture mouse**: locks the pointer and moves the cursor with your own sensitivity
  (`inp_mousesens`, `cl_dyncam_mousesens`).
- **Show distances**: circles for the max and min cursor distance, the deadzone and the max camera offset,
  and live values.
- The tee behaves like in game: the laser fires with real collisions and bounces (classic fng tuning) and recoil,
  the hammer swings, the hook flies, grabs or retracts on the map, and the tee blinks when idle.
  Left click fires, right click hooks, the mouse wheel switches between laser and hammer.
- Tooltips with the live limit formula and the values that have no effect, and warnings for settings that lock
  the camera or the cursor.
- Commands ready to paste in the game console: `cl_dyncam` and the settings of the camera mode shown.
  Values changed since the start are highlighted.
- Load from game: a console request prints your values in game, paste the result back here.
  `settings_ddnet.cfg` can also be pasted or dropped, with help to find it.
- Share link, reset to your loaded values or to the defaults with undo, image of the view for Discord.
- The last config is kept in the browser.

## Apply the commands in game

Press F1 to open the console, paste with Ctrl+V, then press Enter. DDNet saves the values when you quit.

## Run locally

The page uses JavaScript modules and loads its files with `fetch`, so browsers do not run it from a file opened directly.
Serve the folder with any static web server, for example:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. There is no build step: the files of the repository are the site.

## Code checks

The site needs no install. To check the code with [ESLint](https://eslint.org) and [Prettier](https://prettier.io)
(Node.js 18 or later):

```sh
npm install
npm run check
```

`npm run format` formats the files.

GitHub Actions runs the same checks on every push (`.github/workflows/checks.yml`). The site is published on GitHub Pages
only when they pass, and each new version shown in `index.html` gets its tag and GitHub Release (`publish.yml`).

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

- Zoom 1 only.
- Map animations (envelopes) are not played: moving decorations stay at their start position.
- Flags, pickups and other items of the maps are not drawn.
- The view needs WebGL 2. The GPU and its driver can change a few pixels, as between two computers in game.
- When the hook grabs the ground, the game pulls the tee toward it. Here the tee stays in place.
- The laser and hook use the classic fng tuning: laser reach 800 with one bounce, hook length 380.

## License

The code is released under the zlib license (see [LICENSE](LICENSE)).
The graphics and fonts come from DDNet, Teeworlds and third parties and keep their own licenses
(see [CREDITS.md](CREDITS.md)).
