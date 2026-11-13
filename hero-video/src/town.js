// The world: one town on a floating slab (your street, your shop, the shop down the road, the houses across town),
// and two small sets beside it: the basement where the pipe leaks, and the crew photo the thank-you carries.
import * as THREE from 'three';
import { C, mat, rbox, sphere, cyl, house, tree, bush, fence, van, person, shop, streetLamp, rempoMark, ownMat, mesh } from './kit.js';
import { rng } from './anim.js';

export const ROAD_Z = 5.6;          // centre line of the main road
// The ground. The grass box rests at GRASS.y and is GRASS.h high, so its top (GROUND) is at y 0.01. Each flat layer on
// it has a height of its own, above the grass and below the lamps' light pools (y 0.03, kit.js): two surfaces at one
// height fight for the same pixels, and the film shows them flickering between their colours. The sidewalks once sat
// exactly on the grass top and flickered white and green in every street shot.
// The paths to the doors and the shops' forecourts (y 0.008) sit just under the grass top, as in the film as approved,
// so they do not show.
export const GRASS = { y: -0.24, h: 0.25 };
export const GROUND = GRASS.y + GRASS.h;
export const LAYER = { walk: GROUND + 0.006, road: GROUND + 0.01, line: GROUND + 0.014 };
export const LANE_NEAR = 6.25;      // the lane the vans drive in (toward +x)
export const LANE_FAR = 4.95;       // the other lane (toward -x)

export function buildTown(scene) {
  const T = { houses: [], people: {}, vans: {}, lamps: [], trees: [], windows: [] };
  const town = new THREE.Group();
  scene.add(town);
  T.group = town;

  // The slab: a rounded base, the grass on top, the road and the sidewalks
  const W = 50, D0 = -12.5, D1 = 10.5, DEP = D1 - D0, CZ = (D0 + D1) / 2;
  town.add(rbox(W, 1.4, DEP, 1.2, C.slab, { y: -1.45, z: CZ, s: 6 }));
  town.add(rbox(W - 0.5, GRASS.h, DEP - 0.5, 0.9, C.grass, { y: GRASS.y, z: CZ, s: 5 }));
  const flat = (w, d, color, x, z, y) => {
    const m = mesh(new THREE.PlaneGeometry(w, d), mat(color), { cast: false });
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    town.add(m);
    return m;
  };
  // The sidewalks reach 0.03 under the road's edges, so no sliver of grass shows between the two (a strip thinner than a
  // pixel shimmers as the camera moves). Their outer edges stay 2.325 from the centre line.
  const ROAD_D = 2.7, WALK_IN = ROAD_D / 2 - 0.03, WALK_OUT = 2.325;
  flat(W - 1.2, ROAD_D, C.road, 0, ROAD_Z, LAYER.road);
  flat(W - 1.2, WALK_OUT - WALK_IN, C.walk, 0, ROAD_Z - (WALK_IN + WALK_OUT) / 2, LAYER.walk);
  flat(W - 1.2, WALK_OUT - WALK_IN, C.walk, 0, ROAD_Z + (WALK_IN + WALK_OUT) / 2, LAYER.walk);
  for (let x = -23; x < 23; x += 1.9) flat(0.9, 0.11, C.roadLine, x, ROAD_Z, LAYER.line);

  // The front row along the road, left to right: your shop, five houses, the shop down the road
  const yours = shop({ wall: C.wallBlue, trim: C.roofNavy, sign: C.blue, words: ['MAPLE STREET', 'PLUMBING · HEATING'] });
  yours.position.set(-17.2, 0, 0.9);
  town.add(yours);
  flat(3.2, 2.0, C.path, -19.6, 3.4, 0.008);
  T.yours = yours;
  const rival = shop({ wall: C.wallWhite, trim: '#c4573a', sign: C.stripeRival, words: ['DOWN THE ROAD', 'PLUMBING · AIR'] });
  rival.position.set(17.4, 0, 0.9);
  town.add(rival);
  flat(3.2, 2.0, C.path, 19.8, 3.4, 0.008);
  T.rival = rival;

  const front = [
    { x: -10.6, wall: C.wallCream, roof: C.roofNavy, door: C.doorBlue },     // Dana's house
    { x: -5.6, wall: C.wallWhite, roof: C.roofBlue, door: C.doorNavy, flip: true },
    { x: -0.6, wall: C.wallCream, roof: C.roofGrey, door: C.doorRed },
    { x: 4.4, wall: C.wallBlue, roof: C.roofCoral, door: C.doorNavy, flip: true },
    { x: 9.4, wall: C.wallSand, roof: C.roofNavy, door: C.doorBlue },
  ];
  for (const f of front) {
    const h = house({ ...f, w: 3.1, d: 2.7 });
    h.position.set(f.x, 0, 0.9);
    town.add(h);
    T.houses.push(h);
    T.windows.push(...h.windows);
    flat(0.8, 1.1, C.path, f.x + h.front.x, 3.05, 0.008);
  }
  // fences beside some front gardens
  for (const [x, len] of [[-12.95, 1.4], [-8.2, 1.3], [1.9, 1.3], [6.9, 1.4]]) {
    const fz = fence(len, { posts: 4 });
    fz.position.set(x, 0, 3.0);
    town.add(fz);
  }

  // The back row: across town
  const back = [
    { x: -19.5, wall: C.wallWhite, roof: C.roofCoral },
    { x: -14.2, wall: C.wallCream, roof: C.roofBlue, flip: true },
    { x: -8.6, wall: C.wallBlue, roof: C.roofNavy },
    { x: -3.0, wall: C.wallWhite, roof: C.roofGrey, flip: true },
    { x: 2.6, wall: C.wallCream, roof: C.roofCoral },
    { x: 8.2, wall: C.wallWhite, roof: C.roofNavy, flip: true },
    { x: 13.8, wall: C.wallSand, roof: C.roofBlue },
    { x: 19.4, wall: C.wallCream, roof: C.roofNavy, flip: true },   // the house across town
  ];
  for (const b of back) {
    const h = house({ ...b, w: 3.0, d: 2.6, door: C.doorNavy });
    h.position.set(b.x, 0, -7.4);
    town.add(h);
    T.houses.push(h);
    T.windows.push(...h.windows);
  }
  T.acrossTown = T.houses[T.houses.length - 1];

  // Trees and bushes, scattered where nothing stands
  const r = rng(11);
  const spots = [[-14.2, 1.0], [-13.2, -2.8], [-8.1, -1.6], [-3.1, -2.9], [1.9, -1.5], [6.9, -2.6], [12.6, -0.6], [13.4, 2.2],
    [-22.2, -3.5], [22.4, -3.0], [-22.6, 1.8], [22.5, 2.2], [-16.8, -4.2], [16.9, -4.4], [11.0, -4.6], [-0.2, -4.8],
    [-11.3, -10.6], [-5.8, -10.9], [5.4, -10.7], [11.0, -10.8], [16.6, -10.6], [-17.0, -10.8], [22.6, -9.5], [-22.6, -9.0]];
  spots.forEach(([x, z], i) => {
    const t = tree({ s: 0.85 + r() * 0.45, seed: i });
    t.position.set(x, 0, z);
    t.rotation.y = r() * Math.PI;
    town.add(t);
    T.trees.push(t);
  });
  for (const [x, z] of [[-12.0, 2.6], [-9.2, 2.7], [-4.1, 2.6], [0.9, 2.65], [5.9, 2.7], [10.9, 2.6], [-15.0, 2.9], [15.1, 2.9], [-20.6, -5.6], [20.6, -5.2], [-6.0, -5.3], [5.2, -5.4]]) {
    const b = bush({ s: 0.8 + r() * 0.5 });
    b.position.set(x, 0, z);
    town.add(b);
  }

  // Street lamps along the far sidewalk
  for (const x of [-13.6, -8.1, -3.1, 1.9, 6.9, 12.2]) {
    const l = streetLamp();
    l.position.set(x, 0, ROAD_Z - 1.95);
    l.rotation.y = -Math.PI / 2;
    town.add(l);
    T.lamps.push(l);
  }

  // The vans: yours (the blue stripe and the ladder) and theirs (orange)
  T.vans.yours = van({ stripe: C.stripe, ladder: true });
  T.vans.rival = van({ stripe: C.stripeRival, ladder: false });
  T.vans.rival2 = van({ stripe: C.stripeRival, ladder: false });
  town.add(T.vans.yours, T.vans.rival, T.vans.rival2);

  // People
  const P = T.people;
  P.techA = person({ shirt: C.techShirt, skin: C.skin[0], hat: 'cap', capColor: C.techCap });
  P.techB = person({ shirt: C.techShirt, skin: C.skin[3], hat: 'cap', capColor: C.capNavy });
  P.owner = person({ shirt: '#1f5fd1', skin: C.skin[2], hat: 'cap', capColor: C.capNavy, scale: 1.04 });
  P.dana = person({ shirt: '#f08a9b', pants: '#3a4e7a', skin: C.skin[4], hat: 'bun', hair: C.hair[2] });
  P.leak = person({ shirt: '#5cbf7a', pants: '#2d3b57', skin: C.skin[1], hat: 'hair', hair: C.hair[1] });
  P.kid = person({ shirt: '#ffc94d', pants: '#3a4e7a', skin: C.skin[4], hat: 'hair', hair: C.hair[2], scale: 0.62 });
  P.next = person({ shirt: '#8a7be0', pants: '#2d3b57', skin: C.skin[1], hat: 'long', hair: C.hair[4] });
  P.rivalTech = person({ shirt: C.rivalShirt, skin: C.skin[1], hat: 'cap', capColor: C.rivalCap });
  for (const k of Object.keys(P)) town.add(P[k]);

  // The Rempo mark, floating over your street once Rempo arrives
  T.mark = rempoMark({ size: 1.7 });
  T.mark.children[1].visible = false;   // it floats: no plinth
  town.add(T.mark);
  T.mark.visible = false;

  return T;
}

// The basement across town: a cut-away room at night, a water heater leaking onto the floor, and the homeowner
// coming down the stairs with her phone.
export function buildBasement(scene, at) {
  const B = {};
  const g = new THREE.Group();
  g.position.copy(at);
  scene.add(g);
  B.group = g;
  g.add(rbox(9.5, 0.9, 7.5, 0.7, C.slab, { y: -0.95, s: 5 }));
  g.add(rbox(9.1, 0.12, 7.1, 0.5, '#cfd6e1', { y: -0.1, s: 4 }));       // concrete floor
  g.add(rbox(9.1, 4.0, 0.4, 0.15, '#e9e2d4', { z: -3.35 }));            // back wall
  g.add(rbox(0.4, 4.0, 7.1, 0.15, '#e2dacb', { x: -4.35 }));            // left wall
  // stairs down the left wall
  for (let i = 0; i < 7; i++) g.add(rbox(1.25, 0.5 * (7 - i), 0.55, 0.05, '#c9ab86', { x: -3.4, z: -2.85 + i * 0.55 }));
  const rail = rbox(0.07, 0.07, 4.3, 0.03, '#b08c66', { x: -2.72, y: 3.55, z: -1.05 });
  rail.rotation.x = -0.72;
  g.add(rail);
  // water heater with pipes
  g.add(cyl(0.62, 0.62, 2.3, C.heater, { x: 2.4, z: -2.35, seg: 40 }));
  g.add(cyl(0.64, 0.64, 0.18, '#c6d0dc', { x: 2.4, y: 2.25, z: -2.35, seg: 40 }));
  g.add(cyl(0.64, 0.64, 0.14, '#c6d0dc', { x: 2.4, y: 0.0, z: -2.35, seg: 40 }));
  for (const dx of [-0.25, 0.25]) g.add(cyl(0.07, 0.07, 1.6, '#c9925b', { x: 2.4 + dx, y: 2.38, z: -2.35, seg: 12 }));
  g.add(rbox(0.5, 0.3, 0.12, 0.04, '#e05a4a', { x: 2.4, y: 0.55, z: -1.72 }));
  // shelves and boxes
  g.add(rbox(2.0, 0.08, 0.7, 0.03, '#d6b48a', { x: -0.4, y: 1.7, z: -2.85 }));
  g.add(rbox(2.0, 0.08, 0.7, 0.03, '#d6b48a', { x: -0.4, y: 0.9, z: -2.85 }));
  g.add(rbox(0.7, 0.5, 0.5, 0.04, '#e3c49a', { x: -0.9, y: 1.78, z: -2.85 }));
  g.add(rbox(0.55, 0.42, 0.45, 0.04, '#d9b98d', { x: -0.1, y: 0.98, z: -2.85 }));
  g.add(rbox(0.9, 0.6, 0.7, 0.05, '#e3c49a', { x: 0.2, z: -1.3 }));
  g.add(rbox(0.6, 0.45, 0.55, 0.05, '#d9b98d', { x: 0.25, y: 0.6, z: -1.3 }));
  // the bulb
  const bulb = ownMat('#fff1c8', { emissive: '#ffd98a', emissiveIntensity: 1.4 });
  g.add(cyl(0.012, 0.012, 1.0, '#555', { y: 3.2, x: 0.6, z: -0.5, seg: 6 }));
  g.add(sphere(0.13, bulb, { y: 3.15, x: 0.6, z: -0.5, detail: 16, cast: false }));
  B.bulb = bulb;
  // the water: a thin puddle that spreads, and a trickle from the tank
  const waterMat = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78 });
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 64), waterMat);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(1.7, 0.03, -1.0);
  puddle.receiveShadow = true;
  g.add(puddle);
  B.puddle = puddle;
  const trickle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 10), waterMat);
  trickle.position.set(2.4, 0.3, -1.74);
  g.add(trickle);
  B.trickle = trickle;
  B.drops = [];
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), waterMat);
    g.add(d);
    B.drops.push(d);
  }
  // the homeowner
  B.woman = person({ shirt: '#8a7be0', pants: '#2d3b57', skin: C.skin[3], hat: 'long', hair: C.hair[1] });
  g.add(B.woman);
  // light from the bulb
  const pl = new THREE.PointLight('#ffd890', 0, 14, 1.6);
  pl.position.set(0.6, 2.9, -0.4);
  g.add(pl);
  B.light = pl;
  return B;
}

// The crew photo for the thank-you: three of your crew in front of the van, against the sky.
export function buildCrewPhoto(scene, at) {
  const g = new THREE.Group();
  g.position.copy(at);
  scene.add(g);
  g.add(rbox(16, 0.4, 10, 0.2, C.grass, { y: -0.4 }));
  const v = van({ stripe: C.stripe, ladder: true });
  v.rotation.y = Math.PI / 2;
  v.position.set(0.2, 0, -1.4);
  g.add(v);
  const crew = [
    person({ shirt: C.techShirt, skin: C.skin[0], hat: 'cap', capColor: C.techCap }),
    person({ shirt: C.techShirt, skin: C.skin[3], hat: 'cap', capColor: C.capNavy }),
    person({ shirt: '#1f5fd1', skin: C.skin[2], hat: 'cap', capColor: C.capNavy, scale: 1.04 }),
  ];
  crew.forEach((p, i) => { p.position.set(-1.25 + i * 1.25, 0, 0.6); g.add(p); });
  for (const [x, z, s] of [[-4.6, -2.6, 1.3], [4.8, -2.2, 1.2]]) {
    const t = tree({ s, seed: Math.round(x) });
    t.position.set(x, 0, z);
    g.add(t);
  }
  return { group: g, crew, van: v };
}
