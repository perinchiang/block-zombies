# 方块尸潮（暂定名）

方块小人越肩视角打僵尸，手机横屏优先。画面全部由代码生成：没有图片、模型或音频文件。

当前阶段：**第二天 · 60 秒一局**。能操作、能打完一局；画风已锁定（排线阴影）。

在线预览：https://perinchiang.github.io/block-zombies/ （推送到 main 后由 GitHub Actions 自动部署）

## 运行

```bash
npm install
npm run dev          # http://localhost:5191 ，同一 Wi-Fi 的手机可用局域网地址打开
```

操作：

- 手机横屏：左半屏按住即出现摇杆（移动）；右半屏拖动转身；按住开火键连射，按住时拖动也能转身。
- 电脑：WASD / 方向键移动，点击画面锁定鼠标后用鼠标转身，左键或空格开火，Q/E 也能转身。

调试参数：

- `?skip` 跳过开始面板
- `?auto` 机器人自动打一局（熟练）；`?auto=weak` 手残档；`?speed=2` 加速
- `?fps` 显示帧时间和僵尸数量
- `?still` 定格画面（截图用）
- `?shade=flat` 阴影改为纯墨块、不排线（未选用的对比方案 B）
- `?cam=x,y,z&look=x,y,z` 试镜头（相对主角的偏移）

触控测试：`node tools/touch-test.mjs`（左手推摇杆 + 右手按住开火拖动，需先开 dev server）。

截图：`node tools/shot.mjs "?still" shots/a.png --w=844 --h=390 --dpr=2 --mobile`（需要先开 dev server）。

## 定位

- 玩法：方块小人越肩打僵尸，一波波尸潮。参考 Call of Mini 的视角和造型路线，主题、角色、地图都是自己的。
- 画风：强线条漫画风。纸白底、统一粗细的黑描边、两三层平涂、黑色硬阴影。不做中国风，不做水墨晕染。
- 技术：Vite + three.js，先验证手机网页版，之后再考虑上 TapTap。

详见 `docs/GAME_DESIGN.md`（目标形态与开发顺序）、`docs/style.md`（画风规则）、`docs/round.md`（当前原型的规则与数值）。
