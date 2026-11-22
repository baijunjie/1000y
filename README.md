# 栖云录

原创武侠题材的 2D 俯视角单机 demo，直接在浏览器里玩。
画面是「3D 预渲染的 2D 贴图 + 实时 2D 光照」：所有角色、建筑、草木都由 three.js 离线渲染成贴图，游戏运行时不做任何 3D 渲染。

## 运行

```bash
pnpm install
pnpm dev        # 打开终端里给出的地址
pnpm build      # 产物在 dist/，可用 pnpm preview 查看
```

需要支持 WebGL2 的桌面浏览器（Chrome / Edge / Safari 新版）。

## 玩法

没有等级。每门武功各有修为（0.00–99.99），用它出手、命中才会精进；对手越强长进越快。
气血上限在受伤与杀敌中增长，内力上限靠打坐，体力上限靠出手，年岁渐长根基自厚。

| 操作 | 说明 |
|---|---|
| 鼠标左键 | 移动 / 攻击 / 对话 / 拾取 / 采集，可按住持续移动 |
| 空格 / 右键 | 当前武功的绝招（修为到一定火候后领悟） |
| Z | 打坐：回复内力与气血，修炼心法 |
| Tab | 选中最近的敌人 |
| C / K / B / L / M | 人物 / 武功 / 行囊 / 任务 / 地图 |
| 1–4 | 快捷物品 |
| 滚轮 | 缩放镜头 |

## 美术方向

- **写实比例，不要 Q 版**：人物约八头身，躯体是蒙皮的连续曲面，不能有木偶式的分节感；动物同理。
- **朴素的武侠，不是仙侠**：粗布、皮革、铁器、斗笠、绑腿这类江湖气的行头；不要白衣飘飘、玉冠、渐变纱袍一类的仙气装扮。
- **有力量感**：主角是宽肩厚胸、赤臂见肌肉的练家子，不是清秀美男。
- 主角戴斗笠（45° 俯视下头顶是最显眼的部分，斗笠即是角色的标志）。

人物与动物的建模代码在 `tools/bake/src/humanoid.ts`、`tools/bake/src/creature_*.ts`，造型参数在 `tools/bake/src/jobs.ts`。

接手开发前先读 [开发笔记](docs/dev-notes.md)：设计取舍的原因、踩过的坑、验证方法和还欠着的事都在里面。

## 目录

| 路径 | 内容 |
|---|---|
| `src/engine/` | WebGL2 渲染器（G-Buffer、延迟光照、阴影遮罩、水面、泛光）、资源加载、程序合成音频 |
| `src/game/` | 世界与寻路、实体、战斗与修炼、任务、昼夜环境、粒子 |
| `src/ui/` | DOM 界面与世界标注 |
| `src/shared/consts.ts` | 烘焙与运行时共用的投影常量和图集格式 |
| `tools/bake/` | 离线烘焙：程序化 3D 建模 → 颜色 / 法线 / 高度 / 光泽 / 阴影图集 |
| `tools/map/build-map.mjs` | 生成世界地图（地表混合图、物件摆放、刷怪点、NPC） |
| `tools/map/check-map.mjs` | 校验地图：出生点到各 NPC、刷怪点、采集点是否走得通 |
| `tools/shot.mjs` | 在无头 Chrome 里打开游戏并截图，用于验证画面 |
| `public/assets/` | 烘焙产物与地图数据 |

## 重新生成素材

烘焙需要本机装有 Chrome（路径可用环境变量 `CHROME_PATH` 指定）。

```bash
pnpm bake <任务名>...                       # 例如 pnpm bake player_sword npcs env_trees
pnpm bake <任务名> --preview --filter='正则'  # 只出预览图到 tmp/preview，不写图集
pnpm map                                    # 重新生成地图
node tools/map/check-map.mjs                # 校验地图连通性
pnpm shot --out=tmp/shot.png --x=100 --z=108 --hour=18
```

任务名见 `tools/bake/src/jobs.ts`、`tools/bake/src/creatures.ts`、`tools/bake/src/env/`。

## 图集格式

每个图集三张图加一份 json：

- `*.color.webp`：颜色，线性空间预乘 alpha 后做 sRGB 编码；已烘入天空遮蔽。
- `*.normal.webp`：R、G 为视空间法线的 x、y，B 为离地高度（× `hScale` 米），A 为「1 − 光泽」。
- `*.shadow.webp`：R 为日光投影，G 为地面环境遮蔽。
- `*.json`：帧矩形与锚点、动画表、碰撞与灯光等附加信息。

运行时由高度通道还原每个像素的世界坐标，做逐像素深度遮挡和点光源光照。
