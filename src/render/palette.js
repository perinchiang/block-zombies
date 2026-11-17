import * as THREE from 'three';

// Coloured comic palette. The sky is warm and the street is cool, so the
// things that matter (hero yellow, zombie green, blood, gold) sit on a
// contrasting ground. Each accent still has one job.
export const HEX = {
  paper: '#efe6d1',     // UI cards and printed paper
  paperShade: '#d9cdb2',
  ink: '#1d1b21',
  shadow: '#3b3360',    // cool violet the shadow side of every colour leans toward

  // sky, read top to bottom; the fog takes the horizon colour
  skyTop: '#3d6fa8',
  skyMid: '#e7956a',
  horizon: '#f6d6a2',
  sun: '#fff1c9',
  skyline: '#a98a9c',   // far buildings: dusty mauve, lost in the haze

  // street
  asphalt: '#6c7385',
  paver: '#cbb593',
  plaza: '#c98466',
  plazaAlt: '#d29475',
  lane: '#f3e2b0',
  stone: '#c3b9a6',
  concrete: '#b9b1a3',
  wall: '#e2c79a',      // mustard render
  wallAlt: '#9fb6b0',   // sea-green render
  wallPink: '#d99e92',
  wallBlue: '#8fa5c4',
  plinth: '#5d5468',
  rust: '#a5553a',
  hazard: '#f0c43c',
  frame: '#efe2c4',
  glass: '#2d3f63',
  blind: '#d9c7a1',
  lamp: '#f6cf6a',
  signBoard: '#f4ead2',
  awningA: '#c84e3c',
  awningB: '#2f7d72',

  // hero
  hero: '#f0b234',      // player only: the warm thing you track
  heroDark: '#34405e',  // trousers
  hair: '#5a3a28',
  pack: '#a8673f',      // leather pack, lighter than the hair so the back reads in two shapes
  packDark: '#7d4630',
  strap: '#3a2d2a',
  skin: '#f3d3ac',

  // weapons: cold metal against the warm hero; never ink black
  gunmetal: '#73859a',
  gunDark: '#474e5a',
  steel: '#c3c9cc',
  wood: '#8f5a36',

  // zombies
  zombie: '#8cbf5b',    // zombie skin
  zombieCloth: '#8e939b',
  gold: '#f2b429',      // coins and rewards only
  blood: '#c4322b',     // danger and damage only
  flash: '#fff3c4',
  fire: '#f2761b',      // gunfire only: muzzle, tracers and impact bursts
};

/** Faded shirts and trousers, one pair per zombie variant. */
export const ZOMBIE_CLOTHES = [
  ['#b4635a', '#4a4658'], ['#6b86ab', '#5b4a3c'], ['#8c72a3', '#3f4a5e'], ['#c9a25a', '#4a4658'],
  ['#6f9a92', '#6b4f3b'], ['#a9a39a', '#3f4a5e'], ['#c07a4a', '#4b5568'], ['#7b8a5a', '#5b4a3c'],
];

export const COL = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new THREE.Color(v)]));
