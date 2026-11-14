# 方块尸潮（暂定名）

方块小人越肩视角打僵尸，手机横屏优先。画面全部由代码生成：没有图片、模型或音频文件。

当前阶段：**第一天 · 画风样张**。只有场景、主角、僵尸和界面占位，还不能玩。

## 运行

```bash
npm install
npm run dev          # http://localhost:5191 ，同一 Wi-Fi 的手机可用局域网地址打开
```

调试参数：

- `?still` 定格画面（截图用）
- `?shade=flat` 阴影改为纯墨块、不排线（画风对比）
- `?cam=x,y,z&look=x,y,z` 试镜头（相对主角的偏移）

截图：`node tools/shot.mjs "?still" shots/a.png --w=844 --h=390 --dpr=2 --mobile`（需要先开 dev server）。

## 定位

- 玩法：方块小人越肩打僵尸，一波波尸潮。参考 Call of Mini 的视角和造型路线，主题、角色、地图都是自己的。
- 画风：强线条漫画风。纸白底、统一粗细的黑描边、两三层平涂、黑色硬阴影。不做中国风，不做水墨晕染。
- 技术：Vite + three.js，先验证手机网页版，之后再考虑上 TapTap。

详见 `docs/style.md`。
