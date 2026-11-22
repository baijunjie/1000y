import type { AnimMeta } from '../../../src/shared/consts';
import { PPU } from '../../../src/shared/consts';
import { DIR_ANGLE } from './anims';
import type { BakeItem } from './core';
import { CAnim, Rig, simulateRig } from './creature_quad';
import { makeChicken, makeDummy } from './creature_misc';
import { makeBoar, makeDeer, makeTiger, makeWolf } from './creature_species';
import type { AtlasJob } from './jobs';

const ALL_DIRS = [0, 1, 2, 3, 4, 5, 6, 7];

/** 把一副骨架与其动画展开成逐帧烘焙任务，帧 key 为 `${anim}_${dir}_${frame}` */
export function rigJob<P>(
  name: string, rig: Rig<P>, defs: CAnim<P>[], info: { radius: number; height: number }, dirs = ALL_DIRS,
): AtlasJob {
  const frames: BakeItem['frames'] = [];
  const anims: Record<string, AnimMeta> = {};
  for (const a of defs) {
    const sim = simulateRig(rig, a);
    anims[a.name] = { n: a.n, fps: a.fps, loop: a.loop, ...(a.hit !== undefined ? { hit: a.hit } : {}) };
    for (const d of dirs) {
      sim.forEach((s, f) => {
        frames.push({
          key: `${a.name}_${d}_${f}`,
          apply: () => {
            rig.root.rotation.y = DIR_ANGLE(d);
            rig.setPose(s.pose);
            rig.loadChains(s.chains);
          },
        });
      });
    }
  }
  return { name, ppu: PPU, ss: 3, hScale: 3.2, aoSamples: 24, items: [{ root: rig.root, frames }], anims, info };
}

/** 动物与木人桩等非人形角色的烘焙任务 */
export const CREATURE_JOBS: Record<string, () => AtlasJob> = {
  mob_wolf: () => { const c = makeWolf(); return rigJob('mob_wolf', c.rig, c.anims, c.info); },
  mob_boar: () => { const c = makeBoar(); return rigJob('mob_boar', c.rig, c.anims, c.info); },
  mob_tiger: () => { const c = makeTiger(); return rigJob('mob_tiger', c.rig, c.anims, c.info); },
  mob_deer: () => { const c = makeDeer(); return rigJob('mob_deer', c.rig, c.anims, c.info); },
  mob_chicken: () => { const c = makeChicken(); return rigJob('mob_chicken', c.rig, c.anims, c.info); },
  mob_dummy: () => { const c = makeDummy(); return rigJob('mob_dummy', c.rig, c.anims, c.info, [0]); },
};
