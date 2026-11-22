/**
 * 烘焙工具与游戏运行时共用的投影常量。
 * 世界坐标：x 向右，y 向上，z 朝向镜头（屏幕下方）。单位：米。
 * 屏幕投影（正交、俯角 PITCH、无偏航）：sx = x，sy = z·SIN − y·COS（向下为正）。
 */
export const PITCH = Math.PI / 4;
export const SIN = Math.sin(PITCH);
export const COS = Math.cos(PITCH);

/** 指向太阳的单位方向（烘焙阴影用，运行时主光方向与之一致）。 */
export const SUN_DIR: [number, number, number] = (() => {
  const v = [-0.55, 0.75, 0.45];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number];
})();

/** 角色贴图基准分辨率（像素/米）。 */
export const PPU = 128;
/** 阴影贴图相对颜色贴图的缩放。 */
export const SHADOW_SCALE = 0.5;

/** 8 方向：下标 i 对应绕 Y 轴旋转 i×45°，0 = 面向镜头（南）。 */
export const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type Dir = (typeof DIRS)[number];

export interface FrameMeta {
  /** 颜色/法线图集内的矩形 [x, y, w, h] */
  r: [number, number, number, number];
  /** 锚点（世界原点）相对帧左上角的像素偏移 */
  a: [number, number];
  /** 阴影图集内的矩形与锚点 [x, y, w, h, ax, ay]，可无 */
  s?: [number, number, number, number, number, number];
  /** 自发光帧（位于颜色图集内）[x, y, w, h, ax, ay] */
  e?: [number, number, number, number, number, number];
}

export interface AnimMeta {
  /** 帧数 */
  n: number;
  /** 播放帧率 */
  fps: number;
  loop: boolean;
  /** 命中判定所在帧（攻击动画） */
  hit?: number;
}

export interface AtlasMeta {
  name: string;
  ppu: number;
  size: [number, number];
  shadowSize?: [number, number];
  shadowPpu?: number;
  /** 高度通道 1.0 对应的米数 */
  hScale: number;
  frames: Record<string, FrameMeta>;
  anims?: Record<string, AnimMeta>;
  /** 物件的碰撞/占位信息等附加数据 */
  info?: Record<string, any>;
}
