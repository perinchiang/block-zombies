import * as THREE from 'three';

// A deliberately small palette. Paper and ink carry the image; the
// accents each have one job so the screen stays readable on a phone.
export const HEX = {
  paper: '#efe6d1',
  paperShade: '#d9cdb2',
  ink: '#1d1b21',
  stone: '#c9c0ae',
  asphalt: '#b4ad9f',
  wall: '#e3d6bb',
  wallAlt: '#cdbd9c',
  rust: '#9a8467',
  hero: '#e0a43a',      // player only: the warm thing you track
  heroDark: '#3b3a44',
  hair: '#4a342a',      // brown, so the back of the head is not an ink blot
  pack: '#7a6248',      // canvas backpack
  gunmetal: '#73859a',  // weapons read as cold metal against the warm hero
  gunDark: '#474e5a',   // grips and magazines: dark, but never as dark as the ink line
  steel: '#c3c9cc',
  wood: '#8f5a36',
  gold: '#f2b429',      // coins and rewards only
  skin: '#f1d7b5',
  zombie: '#9fb48c',    // zombie skin
  zombieCloth: '#8e939b',
  blood: '#c4322b',     // danger and damage only
  flash: '#fff3c4',
};

export const COL = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new THREE.Color(v)]));
