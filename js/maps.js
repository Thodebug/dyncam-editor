/**
 * Maps of the editor: the Teeworlds maps shipped with DDNet (data/maps).
 *
 * images  the images of data/mapres the map's layers use (assets/mapres/<name>.png)
 * tee     where the tee stands: where a lone player spawns on a DDNet server, resting on the ground below
 *         (y = ground top − 15). IGameController::CanSpawn() takes the first spawn tile, row by row,
 *         of the first type found: neutral, then red, then blue.
 */
export const MAPS = [
  { id: 'ctf1', tee: { x: 208, y: 209 }, images: ['grass_doodads', 'grass_main', 'mountains', 'sun'] },
  {
    id: 'ctf2',
    tee: { x: 1648, y: 657 },
    images: [
      'moon',
      'snow',
      'stars',
      'winter_doodads',
      'winter_main',
      'winter_mountains',
      'winter_mountains2',
      'winter_mountains3',
    ],
  },
  {
    id: 'ctf3',
    tee: { x: 752, y: 433 },
    images: ['desert_doodads', 'desert_main', 'desert_mountains', 'desert_mountains2', 'moon'],
  },
  {
    id: 'ctf4',
    tee: { x: 1168, y: 337 },
    images: ['grass_main', 'jungle_background', 'jungle_doodads', 'jungle_main', 'jungle_midground'],
  },
  // Not a spawn: the platform in the middle of the map, where the game captures were taken
  {
    id: 'ctf5',
    tee: { x: 5200, y: 1777 },
    images: ['bg_cloud1', 'bg_cloud2', 'generic_unhookable', 'grass_doodads', 'grass_main'],
  },
  {
    id: 'ctf6',
    tee: { x: 1392, y: 561 },
    images: [
      'grass_main',
      'jungle_background',
      'jungle_deathtiles',
      'jungle_doodads',
      'jungle_main',
      'jungle_midground',
    ],
  },
  { id: 'ctf7', tee: { x: 176, y: 689 }, images: ['grass_doodads', 'grass_main', 'mountains', 'sun'] },
  {
    id: 'dm1',
    tee: { x: 1584, y: 369 },
    images: ['bg_cloud1', 'bg_cloud2', 'bg_cloud3', 'grass_doodads', 'grass_main', 'mountains', 'sun'],
  },
  { id: 'dm2', tee: { x: 144, y: 497 }, images: ['grass_doodads', 'grass_main', 'mountains', 'sun'] },
  {
    id: 'dm6',
    tee: { x: 752, y: 433 },
    images: [
      'desert_doodads',
      'desert_main',
      'desert_mountains',
      'desert_mountains2',
      'generic_deathtiles',
      'generic_unhookable',
      'moon',
    ],
  },
  { id: 'dm7', tee: { x: 1776, y: 465 }, images: ['grass_doodads', 'grass_main', 'moon', 'stars'] },
  {
    id: 'dm8',
    tee: { x: 464, y: 273 },
    images: [
      'generic_deathtiles',
      'generic_unhookable',
      'moon',
      'snow',
      'stars',
      'winter_doodads',
      'winter_main',
      'winter_mountains',
      'winter_mountains2',
      'winter_mountains3',
    ],
  },
  {
    id: 'dm9',
    tee: { x: 1040, y: 177 },
    images: ['grass_main', 'jungle_background', 'jungle_doodads', 'jungle_main', 'jungle_midground', 'moon'],
  },
];

export const DEFAULT_MAP = 'ctf5';

export const MAPS_BY_ID = Object.fromEntries(MAPS.map((map) => [map.id, map]));

export const isMapId = (id) => typeof id === 'string' && Object.hasOwn(MAPS_BY_ID, id);
