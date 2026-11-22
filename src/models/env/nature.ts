import * as THREE from 'three';
import { Palette, SHAPES } from './flora';
import { buildBamboo, buildBroadleaf, buildBush, buildDead, buildPine, buildWillow } from './trees';

export interface SpriteDef {
  key: string;
  build: () => THREE.Object3D;
  info: Record<string, any>;
}

const RED: Palette = [['#a8241c', 4], ['#c63a20', 4], ['#d85a2a', 2.2], ['#8c1d1c', 2], ['#e08a30', 0.8]];
const ORANGE: Palette = [['#d9722a', 4], ['#e39a36', 3], ['#c8501f', 2.4], ['#ecc04e', 1.2], ['#b8431e', 1]];
const GREEN_D: Palette = [['#3d6a2b', 4], ['#4f7d35', 3.5], ['#2f5726', 2.5], ['#688f42', 1.5], ['#86a04a', 0.5]];
const GREEN_L: Palette = [['#5c8a3a', 4], ['#75a046', 3], ['#487632', 2.4], ['#93b054', 1.4], ['#b9b758', 0.5]];
const GREEN_Y: Palette = [['#93aa44', 4], ['#b0b84c', 3], ['#7a973a', 2.4], ['#cfc455', 1.6], ['#dcb448', 0.7]];
const PINE: Palette = [['#2f5a38', 4], ['#3e6e42', 3], ['#27492f', 3], ['#5a8a4c', 1.2]];
const PINK: Palette = [['#f3a9bb', 4], ['#f8c6d1', 3], ['#ea8ba6', 2.4], ['#fbe0e6', 1.2]];

const trunkSolid = (r: number): number[][] => [[-r, -r, r, r]];

export const TREES: SpriteDef[] = [
  {
    key: 'maple_a', info: { kind: 'tree', solid: trunkSolid(0.3) },
    build: () => buildBroadleaf({
      seed: 11, trunkH: 2.5, trunkR: 0.24, bend: 0.26, lean: [0.35, 0.1], nMain: 5, bark: '#6e5646',
      crown: { c: [0, 1.5, 0], r: [2.35, 1.5, 2.05], n: 22, cr: [0.7, 0.98], flat: 0.62, cut: -0.3, shell: 0.5 },
      leaf: { shape: SHAPES.maple, size: [0.13, 0.19], palette: RED, droop: 0.35, fold: 0.1 }, leaves: 900,
    }),
  },
  {
    key: 'maple_b', info: { kind: 'tree', solid: trunkSolid(0.25) },
    build: () => buildBroadleaf({
      seed: 23, trunkH: 2.0, trunkR: 0.18, bend: 0.3, lean: [-0.3, 0.1], nMain: 4, bark: '#735b4a',
      crown: { c: [0, 1.25, 0], r: [1.9, 1.3, 1.7], n: 15, cr: [0.6, 0.86], flat: 0.62, cut: -0.3, shell: 0.5 },
      leaf: { shape: SHAPES.maple, size: [0.12, 0.18], palette: ORANGE, droop: 0.35, fold: 0.1 }, leaves: 920,
    }),
  },
  {
    key: 'tree_a', info: { kind: 'tree', solid: trunkSolid(0.4) },
    build: () => buildBroadleaf({
      seed: 31, trunkH: 3.0, trunkR: 0.32, bend: 0.22, lean: [0.2, 0.1], nMain: 6, bark: '#6f6050',
      crown: { c: [0, 1.9, 0], r: [3.0, 2.1, 2.6], n: 28, cr: [0.9, 1.25], flat: 0.8, cut: -0.32, shell: 0.5 },
      leaf: { shape: SHAPES.oval, size: [0.14, 0.2], palette: GREEN_D, droop: 0.3, fold: 0.18 }, leaves: 700,
    }),
  },
  {
    key: 'tree_b', info: { kind: 'tree', solid: trunkSolid(0.28) },
    build: () => buildBroadleaf({
      seed: 47, trunkH: 2.6, trunkR: 0.2, bend: 0.2, lean: [-0.15, 0.05], nMain: 5, bark: '#7a6852',
      crown: { c: [0, 1.8, 0], r: [1.9, 2.1, 1.75], n: 17, cr: [0.7, 0.95], flat: 0.9, cut: -0.4, shell: 0.5 },
      leaf: { shape: SHAPES.oval, size: [0.13, 0.19], palette: GREEN_L, droop: 0.3, fold: 0.18 }, leaves: 760,
    }),
  },
  {
    key: 'tree_c', info: { kind: 'tree', solid: trunkSolid(0.2) },
    build: () => buildBroadleaf({
      seed: 59, trunkH: 1.8, trunkR: 0.12, bend: 0.14, lean: [0.1, 0], nMain: 4, bark: '#8a7860',
      crown: { c: [0, 1.25, 0], r: [1.35, 1.45, 1.25], n: 11, cr: [0.55, 0.75], flat: 0.9, cut: -0.45, shell: 0.45 },
      leaf: { shape: SHAPES.round, size: [0.11, 0.16], palette: GREEN_Y, droop: 0.3, fold: 0.15 }, leaves: 820, roots: 4,
    }),
  },
  {
    key: 'pine_a', info: { kind: 'tree', solid: trunkSolid(0.34) },
    build: () => buildPine({
      seed: 71, height: 9.0, trunkR: 0.27, bend: 0.4, lean: [0.6, 0.2], tiers: 5, firstTier: 0.46, spread: 2.5,
      bark: '#7a4f36', palette: PINE, padR: [0.75, 1.05], needles: 260,
    }),
  },
  {
    key: 'pine_b', info: { kind: 'tree', solid: trunkSolid(0.28) },
    build: () => buildPine({
      seed: 83, height: 6.4, trunkR: 0.21, bend: 0.65, lean: [-1.1, 0.3], tiers: 4, firstTier: 0.5, spread: 2.1,
      bark: '#7a4f36', palette: PINE, padR: [0.7, 1.0], needles: 260,
    }),
  },
  { key: 'willow_a', info: { kind: 'tree', solid: trunkSolid(0.38) }, build: () => buildWillow(97) },
  {
    key: 'peach_a', info: { kind: 'tree', solid: trunkSolid(0.2) },
    build: () => buildBroadleaf({
      seed: 103, trunkH: 1.0, trunkR: 0.13, bend: 0.2, lean: [0.25, 0], nMain: 4, bark: '#4a3430', barkKind: 'smooth',
      crown: { c: [0, 1.05, 0], r: [1.8, 0.95, 1.6], n: 26, cr: [0.38, 0.58], flat: 0.75, cut: -0.25, shell: 0.5, space: 0.7 },
      leaf: {
        shape: SHAPES.oval, size: [0.08, 0.12], palette: [['#6f9a48', 2], ['#8cae56', 1]], droop: 0.2,
        alt: { shape: SHAPES.flower, size: [0.1, 0.15], palette: PINK, ratio: 0.72 },
      },
      leaves: 470, roots: 4, twigs: 5,
    }),
  },
  { key: 'bamboo_a', info: { kind: 'tree', solid: trunkSolid(0.3) }, build: () => buildBamboo(113, 3, [6.0, 7.6], 0.32) },
  { key: 'bamboo_b', info: { kind: 'tree', solid: trunkSolid(0.45) }, build: () => buildBamboo(127, 5, [6.4, 8.6], 0.5) },
  { key: 'bamboo_c', info: { kind: 'tree', solid: trunkSolid(0.6) }, build: () => buildBamboo(139, 7, [5.6, 9.2], 0.7) },
  { key: 'dead_a', info: { kind: 'tree', solid: trunkSolid(0.3) }, build: () => buildDead(149) },
  {
    key: 'bush_a', info: { kind: 'bush', solid: [[-0.45, -0.3, 0.45, 0.3]] },
    build: () => buildBush({
      seed: 157, w: 1.7, h: 1.05, n: 10, cr: [0.36, 0.5], stems: '#4a3d2e', leaves: 1000,
      leaf: { shape: SHAPES.oval, size: [0.09, 0.13], palette: GREEN_D, droop: 0.2 },
    }),
  },
  {
    key: 'bush_b', info: { kind: 'bush', solid: [[-0.35, -0.25, 0.35, 0.25]] },
    build: () => buildBush({
      seed: 163, w: 1.35, h: 0.9, n: 8, cr: [0.32, 0.44], stems: '#4a3d2e', leaves: 1000,
      leaf: { shape: SHAPES.oval, size: [0.08, 0.12], palette: [['#5c8a3a', 3], ['#8a9a3c', 2], ['#c8702a', 1.6], ['#b9431e', 1.2], ['#d9a23a', 1]], droop: 0.2 },
      berries: { color: '#c2261c', n: 70, r: 0.028 },
    }),
  },
  {
    key: 'bush_c', info: { kind: 'bush', solid: [[-0.55, -0.35, 0.55, 0.35]] },
    build: () => buildBush({
      seed: 173, w: 2.1, h: 1.35, n: 14, cr: [0.38, 0.55], stems: '#4a3d2e', leaves: 950,
      leaf: {
        shape: SHAPES.oval, size: [0.09, 0.13], palette: GREEN_L, droop: 0.2,
        alt: { shape: SHAPES.flower, size: [0.09, 0.12], palette: [['#f6f1e2', 3], ['#f3e3a2', 1]], ratio: 0.13 },
      },
    }),
  },
];
