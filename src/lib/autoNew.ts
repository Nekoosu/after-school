"use client";

import { useEffect } from "react";

/**
 * 顶栏的快捷新建按钮跳到本页 `?new=1`，页面自己把新建弹层打开。
 * 这样手机上不用先找到卡片、再找到那个小按钮，点右下角的 + 就直接进表单。
 * `setOpen` 来自 useState，引用稳定，effect 只会在挂载时跑一次。
 */
export function useAutoNew(setOpen: (v: boolean) => void) {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("new") === "1") setOpen(true);
  }, [setOpen]);
}
