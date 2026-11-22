/**
 * 世界坐标：x 向右（东），y 向上，z 朝向镜头（南）。单位：米。
 */

/** 8 方向：下标 i 对应绕 Y 轴旋转 i×45°，0 = 面向镜头（南）。 */
export const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type Dir = (typeof DIRS)[number];

export interface AnimMeta {
  /** 关键帧数（沿用旧的逐帧动画口径：时长 = n / fps） */
  n: number;
  fps: number;
  loop: boolean;
  /** 命中判定所在帧（攻击动画） */
  hit?: number;
}
