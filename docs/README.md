# docs —— 文档配图

只有一类东西：README 里要用的界面截图。文字说明都在根目录的 `README.md` 与 `AGENTS.md` 里，不在这里。

```
screenshots/  五张实拍界面图，1440px 与 520px 两种宽度
```

## 怎么重新拍

```powershell
node scripts\shot.mjs http://127.0.0.1:3210
```

脚本会把图写到 `.shots\pack\`，挑需要的复制到这里。截图前先用 `scripts\seed-demo.mjs` 灌一套演示数据，否则拍到的是空库——空库的截图看不出版式。

## 拍的时候注意

- 桌面图用 **1440 宽**，手机图用 **520 宽**（Windows 上浏览器最小窗口约 500px，再窄会被裁切，看着像布局溢出）
- 需要拍到页面中段时用 `scroll` 参数，别拍一张超长的图再裁
- 收起侧栏的样子用 `collapse` 参数
- 家长分享页要带签名，地址由 `/api/share/link` 给出，用 `SHOT_SHARE` 环境变量传进去
