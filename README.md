# Dyncam editor

**Open the editor: https://thodebug.github.io/dyncam-editor/**

Set the [DDNet](https://ddnet.org) camera settings on the real game view, then copy the console commands.

DDNet's menu only has two checkboxes for the camera (Dynamic Camera and Smooth Dynamic Camera). Every other
setting, like the cursor distance, the deadzone or the follow factor, can only be changed in the console.
This editor shows what each value does, on the ctf5 map, exactly as the game draws it.

## Features

- The real game view: ctf5 layers with their parallax, the default tee, its weapon and the cursor,
  at zoom 1, on a 16:9 or 21:9 screen.
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
- Notes under each setting when a value has no effect, and warnings for settings that lock the camera or the cursor.
- Commands ready to paste in the game console, with an option to list only the changed values.
- Share link, paste or drop of `settings_ddnet.cfg`, reset with undo, image of the view for Discord.
- The last config is kept in the browser.

## Apply the commands in game

Press F1 to open the console, paste with Ctrl+V, then press Enter. DDNet saves the values when you quit.

## Run locally

The page uses JavaScript modules and reads image pixels, so browsers do not run it from a file opened directly.
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
  settings.js           list of console variables (ranges, defaults, descriptions)
  config-store.js       current values, commands, share link, browser storage
  camera.js             cursor limits and camera smoothing
  collision.js          map collision in 32-bit floats
  player.js             the tee: weapons, attack animations, blinking
  laser.js              laser path and timing
  hook.js               hook flight, grab and retraction
  tee-renderer.js       tee, weapon, hook, laser and cursor sprites
  game-view.js          game view canvas: layers, parallax, distance circles
  pointer.js            aiming, mouse capture, buttons and wheel
  settings-panel.js     setting rows and their notes
  commands-panel.js     commands list, copy, share, paste, reset
  snapshot.js           image of the view with the commands
  tooltip.js            tooltips
assets/
  map/                  ctf5 layers and collision
  sprites/              tee skin, weapons, particles
  fonts/                DejaVu Sans and icons
```

The formulas follow the DDNet source code. Comments in the code name the DDNet function each part comes from.

## Limits

- One map (ctf5) and zoom 1. Screen formats: 16:9 and 21:9. Taller formats (16:10, 4:3, 5:4) need new captures.
- The map images were captured at a zoom of 1.54 and are enlarged to zoom 1, so they are slightly softer
  than in game.
- When the hook grabs the ground, the game pulls the tee toward it. Here the tee stays in place.
- The laser and hook use the classic fng tuning: laser reach 800 with one bounce, hook length 380.

## License

The code is released under the zlib license (see [LICENSE](LICENSE)).
The graphics and fonts come from DDNet, Teeworlds and third parties and keep their own licenses
(see [CREDITS.md](CREDITS.md)).
