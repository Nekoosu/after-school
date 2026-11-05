# public —— 静态资源

```
app.ico         exe 与桌面快捷方式用的图标（多尺寸）
app-icon.png    512×512，PWA 与 favicon 用
manifest.json   PWA 清单（名字、主题色、图标）
sw.js           Service Worker（只注册、不缓存）
```

## sw.js 为什么「只注册不缓存」

这是本地单人使用的系统，数据随时在变。一旦缓存了页面或接口响应，就会看到「明明改了，界面还是旧的」——这种问题在自己机器上尤其难排查。

所以 `sw.js` 只做两件事：接住 `install`（立刻 skipWaiting）和 `fetch`（直接放行）。保留它的意义是「可以装到桌面/添加到主屏幕」，不是离线。

## manifest.json

`name` 里必须带「课后服务」四个字——桌面启动器判断「这个端口上跑的是不是本应用」时，会读 `/manifest.json` 检查这个标记（见 `launcher/Launcher.cs` 的 `Test-Ours`）。改名字时别把这四个字去掉。

## 换图标

1. 替换 `app-icon.png`（512×512）与 `app.ico`（含 16/32/48/256）
2. 重新跑 `scripts\package.ps1`，exe 的内嵌图标来自 `public\app.ico`
