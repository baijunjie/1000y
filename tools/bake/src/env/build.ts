import { PPU } from '../../../../src/shared/consts';
import type { AtlasJob } from '../jobs';
import type { Build } from './arch';
import * as B from './buildings';
import * as P from './props';

function job(name: string, hScale: number, makers: (() => Build)[], shadowRes = 2048): AtlasJob {
  // 只构建被 --filter 选中的模型，预览单个模型时更快
  const q = new URLSearchParams(location.search);
  const filter = q.get('filter') ? new RegExp(q.get('filter')!) : null;
  const items = [];
  for (const mk of makers) {
    const key = mk.name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (filter && !filter.test(key)) continue;
    const b = mk();
    if (b.key !== key) throw new Error(`模型 key 不一致: ${b.key} / ${key}`);
    items.push(b.item());
  }
  return { name, ppu: PPU, ss: 2, hScale, aoSamples: 32, shadowRes, items };
}

/** 建筑与道具的烘焙任务 */
export const BUILD_JOBS: Record<string, () => AtlasJob> = {
  env_build: () => job('env_build', 16, [B.houseA, B.houseB, B.houseC, B.inn, B.smithy, B.clinic, B.dojo]),
  env_build2: () => job('env_build2', 16, [B.gate, B.shrine, B.watchtower, B.tentA, B.tentB, B.palisadeH, B.palisadeGate, B.wallH]),
  env_props: () => job('env_props', 6, [
    P.lanternPost, P.stoneLantern, P.well, P.stallA, P.stallB, P.barrel, P.crate, P.crates, P.cart, P.haystack, P.fenceH, P.fenceV,
    P.signPost, P.campfire, P.bridgeH, P.weaponRack, P.bench, P.table, P.flagA, P.boat, P.pier, P.woodpile, P.pot,
  ], 1024),
};
