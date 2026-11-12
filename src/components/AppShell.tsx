"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Menu, MenuItem, Modal } from "./ui";
import { SearchPalette } from "./SearchPalette";
import { cn } from "@/lib/format";
import { AUTHOR_NAME, AUTHOR_URL } from "@/lib/author";

interface NavLink {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: "pending" | "low";
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

type ThemePref = "light" | "dark" | "system";

/** 现在是不是跑在桌面壳里（自带窗口的 exe）：壳会给 UA 加一句 AfterSchoolShell/1.0 */
function isShell(): boolean {
  if (typeof window === "undefined") return false;
  if (/AfterSchoolShell/i.test(navigator.userAgent)) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

/** 跟桌面壳说一句话（壳在 WebMessageReceived 里接）：as-page:<页面名> 用来改窗口标题 */
function postToShell(message: string) {
  const w = window as unknown as { chrome?: { webview?: { postMessage?: (m: string) => void } } };
  try {
    w.chrome?.webview?.postMessage?.(message);
  } catch {
    /* 壳不在（浏览器里打开）就算了 */
  }
}

const SHORTCUTS: Array<{ keys: string; what: string }> = [
  { keys: "Ctrl+K", what: "全局搜索：学生、课程、教案、上课记录" },
  { keys: "Ctrl+N", what: "排一节课（跳到课表并打开新建）" },
  { keys: "Ctrl+Shift+N", what: "加一个学生" },
  { keys: "Ctrl+P", what: "打印当前页（课表、对账单、月报都能打）" },
  { keys: "Ctrl+F", what: "打开搜索（同 Ctrl+K）" },
  { keys: "Ctrl+B", what: "收起 / 展开左侧导航" },
  { keys: "?", what: "打开这份快捷键说明" },
  { keys: "Esc", what: "关掉弹窗、菜单、搜索面板" },
  { keys: "Enter", what: "在搜索框里打开第一条结果" },
];

const GROUPS: NavGroup[] = [
  {
    label: "概览",
    links: [
      { href: "/", label: "今日", icon: "home", exact: true },
      { href: "/calendar", label: "课表", icon: "calendar" },
      { href: "/students", label: "学生", icon: "users", badge: "low" },
    ],
  },
  {
    label: "教学",
    links: [
      { href: "/teachers", label: "老师", icon: "cap" },
      { href: "/feedback", label: "家长反馈", icon: "message", badge: "pending" },
      { href: "/plans", label: "备课", icon: "book" },
      { href: "/records", label: "上课记录", icon: "clipboard" },
      { href: "/monthly", label: "月报", icon: "file" },
    ],
  },
  {
    label: "管理",
    links: [
      { href: "/finance", label: "收支", icon: "wallet" },
      { href: "/stats", label: "统计", icon: "bars" },
      { href: "/classes", label: "班级", icon: "layers" },
      { href: "/settings", label: "设置", icon: "settings" },
      { href: "/manual", label: "使用说明", icon: "info" },
    ],
  },
];

const TABBAR: NavLink[] = [
  { href: "/", label: "今日", icon: "home", exact: true },
  { href: "/calendar", label: "课表", icon: "calendar" },
  { href: "/students", label: "学生", icon: "users" },
  { href: "/feedback", label: "反馈", icon: "message" },
];

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "今日"],
  [/^\/calendar\/print/, "课表打印"],
  [/^\/docs/, "接口文档"],
  [/^\/share/, "孩子的小档案"],
  [/^\/calendar/, "课表"],
  [/^\/students\/\d+\/statement/, "上课对账单"],
  [/^\/students\/\d+/, "学生详情"],
  [/^\/students/, "学生"],
  [/^\/lessons\/\d+\/wrap/, "跟家长说一句"],
  [/^\/lessons\/\d+/, "记一笔"],
  [/^\/feedback/, "家长反馈"],
  [/^\/teachers/, "老师"],
  [/^\/plans/, "备课"],
  [/^\/records/, "上课记录"],
  [/^\/monthly/, "月报"],
  [/^\/finance/, "收支"],
  [/^\/stats/, "统计"],
  [/^\/classes/, "班级"],
  [/^\/manual/, "使用说明"],
  [/^\/settings/, "设置"],
];

function isActive(pathname: string, link: NavLink): boolean {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(link.href + "/");
}

function titleOf(pathname: string): string {
  for (const [re, t] of TITLES) if (re.test(pathname)) return t;
  return "课后服务";
}

function todayLabel(): string {
  const d = new Date();
  const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
}

interface QuickAction {
  href: string;
  label: string;
}

/**
 * 顶栏与右下角浮动按钮的「当前页最想做的那件事」。
 * 之前顶栏永远挂着「新学生」，在课表页看着莫名其妙，现在按页面给不同动作。
 */
function actionOf(pathname: string): QuickAction | null {
  if (/^\/calendar\/print/.test(pathname)) return null;
  if (/^\/students\/\d+/.test(pathname)) return { href: `${pathname}?new=1`, label: "记一笔" };
  if (/^\/$/.test(pathname)) return { href: "/calendar?new=1", label: "排课" };
  if (/^\/calendar/.test(pathname)) return { href: "/calendar?new=1", label: "排课" };
  if (/^\/students/.test(pathname)) return { href: "/students?new=1", label: "新学生" };
  if (/^\/plans/.test(pathname)) return { href: "/plans?new=1", label: "写教案" };
  if (/^\/classes/.test(pathname)) return { href: "/classes?new=1", label: "新建班级" };
  if (/^\/finance/.test(pathname)) return { href: "/finance?new=1", label: "记收款" };
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const action = useMemo(() => actionOf(pathname), [pathname]);
  const [navOpen, setNavOpen] = useState(false);
  // 侧边栏在桌面可以收成一列图标（手机上是抽屉，不走这个状态）
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  // 日期只在挂载后渲染：页面是构建时预渲染的静态 HTML，直接用 new Date() 会和客户端渲染不一致（React #418）
  const [dateLabel, setDateLabel] = useState("");
  const [org, setOrg] = useState("课后服务中心");
  const [pending, setPending] = useState(0);
  const [low, setLow] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [, setThemePref] = useState<"light" | "dark" | "system">("system");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);
  // 有请求在飞时顶上一条细进度条：本地库里多数查询几十毫秒，但导出、月报这种会慢
  const [busy, setBusy] = useState(false);
  // 授权横幅：试用还剩几天 / 已锁。激活本身在桌面壳的「激活」窗口里做，这里只提醒。
  const [lic, setLic] = useState<{ mode: "licensed" | "trial" | "locked"; daysLeft: number | null } | null>(null);

  useEffect(() => {
    fetch("/api/license", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLic(d))
      .catch(() => setLic(null));
  }, []);

  useEffect(() => {
    setNavOpen(false);
    setSearchOpen(false);
    setHelpOpen(false);
    // 标题跟着页面走：浏览器标签、任务栏、任务视图里都能认出是哪一页。
    // 1.8.12 起桌面壳的窗口标题也照抄这里（DocumentTitleChanged），
    // 所以壳里同样带上页面名——Alt+Tab 一眼能看出停在哪一页。
    document.title = `${titleOf(pathname)} · 课后服务管理`;
    // 桌面壳的窗口标题靠这一句（壳里 document.title 会被 Next 的 metadata 盖回「课后服务管理」）
    if (isShell()) postToShell(`as-page:${titleOf(pathname)}`);
  }, [pathname]);

  // 桌面壳里把「网页感」收掉：右键菜单、双击选词、拖图片一律不响应（输入框和手册正文除外）
  useEffect(() => {
    if (!isShell()) return;
    document.documentElement.dataset.shell = "app";
    const isText = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n || !n.tagName) return false;
      const tag = n.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (tag === "pre" || tag === "code") return true;
      if (n.isContentEditable) return true;
      return Boolean(n.closest?.(".manual-body, .md, .selectable, .share-body"));
    };
    const onContext = (e: MouseEvent) => {
      if (!isText(e.target)) e.preventDefault();
    };
    const onDrag = (e: DragEvent) => e.preventDefault();
    const onSelectStart = (e: Event) => {
      if (!isText(e.target)) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("dragstart", onDrag);
    document.addEventListener("selectstart", onSelectStart);
    return () => {
      delete document.documentElement.dataset.shell;
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("dragstart", onDrag);
      document.removeEventListener("selectstart", onSelectStart);
    };
  }, []);

  // 侧边栏收/展：读本地记住的状态 + 跟着窗口宽度判断「现在是不是手机布局」
  useEffect(() => {
    setNavCollapsed(localStorage.getItem("as-nav-collapsed") === "1");
    const mq = window.matchMedia("(max-width: 980px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // 回收：手机上其实是抽屉，桌面上才是真的折叠
  const collapsed = navCollapsed && !narrow;

  function toggleNav() {
    if (narrow) {
      setNavOpen((v) => !v);
      return;
    }
    const next = !navCollapsed;
    setNavCollapsed(next);
    localStorage.setItem("as-nav-collapsed", next ? "1" : "0");
  }

  // Ctrl/⌘ + B：收/展侧边栏
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        const next = !(localStorage.getItem("as-nav-collapsed") === "1");
        localStorage.setItem("as-nav-collapsed", next ? "1" : "0");
        setNavCollapsed(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 「?」叫出快捷键说明（在输入框里打字时不拦）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 手机抽屉拉开时别让底下的页面跟着滚；Esc 关掉它
  useEffect(() => {
    if (!narrow || !navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [narrow, navOpen]);

  // 主题：浅色 / 深色 / 跟随系统（没选过就跟系统走，系统切了也跟着切）
  useEffect(() => {
    const saved = localStorage.getItem("as-theme");
    const pref: ThemePref = saved === "light" || saved === "dark" ? saved : "system";
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    applyTheme(pref, dark);
    setThemeReady(true);
    setDateLabel(todayLabel());

    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      const now = localStorage.getItem("as-theme");
      if (now !== "light" && now !== "dark") {
        applyTheme("system", window.matchMedia("(prefers-color-scheme: dark)").matches);
      }
    };
    mq?.addEventListener?.("change", onSystemChange);
    // 设置页的「外观」改了主题，这边跟着换图标，别让两处对不上
    const onThemeEvent = () => {
      const now = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      setTheme(now);
      const saved2 = localStorage.getItem("as-theme");
      setThemePref(saved2 === "light" || saved2 === "dark" ? saved2 : "system");
    };
    window.addEventListener("as-theme", onThemeEvent);
    return () => {
      mq?.removeEventListener?.("change", onSystemChange);
      window.removeEventListener("as-theme", onThemeEvent);
    };
  }, []);

  function applyTheme(pref: ThemePref, systemDark: boolean) {
    const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;
    document.documentElement.dataset.theme = resolved;
    setTheme(resolved);
    setThemePref(pref);
    if (pref === "system") localStorage.removeItem("as-theme");
    else localStorage.setItem("as-theme", pref);
  }

  function pickTheme(pref: ThemePref) {
    applyTheme(pref, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  }

  // ⌘K / Ctrl+K 打开搜索
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/⌘ + N：排一节课；Ctrl/⌘ + Shift + N：加一个学生（在输入框里打字时不拦）
  // Ctrl+P 打印、Ctrl+F 打开搜索：桌面壳里 WebView2 的内置快捷键是关掉的（否则 Ctrl+N 会被它拿去开新窗）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || !!el?.isContentEditable;
      if (key === "p") {
        e.preventDefault();
        window.print();
        return;
      }
      if (key === "f" && !typing) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (key !== "n" || typing) return;
      e.preventDefault();
      window.location.href = e.shiftKey ? "/students?new=1" : "/calendar?new=1";
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 请求在飞就把顶上那条进度条点亮（api() 会发 as-busy 事件，带当前在飞数量）
  useEffect(() => {
    function onBusy(e: Event) {
      const n = (e as CustomEvent<number>).detail ?? 0;
      setBusy(n > 0);
    }
    window.addEventListener("as-busy", onBusy);
    return () => window.removeEventListener("as-busy", onBusy);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive || !s) return;
        if (s.org_name) setOrg(String(s.org_name));
      })
      .catch(() => {});
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setPending(Array.isArray(d.makeupPending) ? d.makeupPending.length : 0);
        setLow(Array.isArray(d.lowBalanceStudents) ? d.lowBalanceStudents.length : 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  const counts = useMemo(() => ({ pending, low }), [pending, low]);

  // 家长分享页是给家长看的，不带侧栏、顶栏和底部导航
  if (pathname.startsWith("/share")) {
    return <div className="share-plain">{children}</div>;
  }

  return (
    <div className={cn("shell", collapsed && "nav-collapsed")}>
      <div className={cn("scrim", navOpen && "show")} onClick={() => setNavOpen(false)} />

      <aside className={cn("sidebar", navOpen && "open")}>
        <div className="sidebar-brand">
          {/* 收起之后整个侧栏只剩这一个方块，点它就是「打开侧边栏」 */}
          {collapsed ? (
            <button
              type="button"
              className="brand-mark brand-mark-btn"
              onClick={toggleNav}
              title="展开侧边栏（Ctrl+B）"
              aria-label="展开侧边栏"
            >
              课
            </button>
          ) : (
            <div className="brand-mark">课</div>
          )}
          <div className="brand-text">
            <div className="brand-name">{org}</div>
            <div className="brand-sub">课后服务管理</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.links.map((l) => {
                const active = isActive(pathname, l);
                const n = l.badge ? counts[l.badge] : 0;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn("nav-item", active && "active")}
                    title={collapsed ? l.label : undefined}
                    data-label={l.label}
                  >
                    <Icon name={l.icon} size={17} />
                    <span>{l.label}</span>
                    {n > 0 ? <span className={cn("nav-count", l.badge === "pending" && "hot")}>{n}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div>数据都存在本机</div>
          <div style={{ marginTop: 2 }}>记得每周备份一次</div>
          {AUTHOR_URL ? (
            <a
              className="sidebar-author"
              href={AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
              title={`作者 ${AUTHOR_NAME} 的主页`}
            >
              <Icon name="external" size={12} />
              <span>作者：{AUTHOR_NAME}</span>
            </a>
          ) : null}
          <button
            type="button"
            className="sidebar-fold"
            onClick={toggleNav}
            title="收起侧边栏（Ctrl+B）"
            aria-label="收起侧边栏"
          >
            <Icon name="arrowLeft" size={14} />
            <span>收起侧边栏</span>
            <kbd className="kbd">Ctrl+B</kbd>
          </button>
        </div>
      </aside>

      <div className="main">
        <div className={cn("busybar", busy && "on")} aria-hidden="true" />
        {/* 试用/未激活的提醒条（1.8.13）：正常激活后整条不出现 */}
        {lic && lic.mode !== "licensed" ? (
          <div className={cn("license-bar", lic.mode === "locked" && "bad")}>
            <Icon name="clock" size={14} />
            <span>
              {lic.mode === "trial"
                ? `试用版：还剩 ${lic.daysLeft ?? 0} 天。到期后在桌面程序的「激活」窗口里填激活码。`
                : "这台电脑还没激活：请用桌面程序打开，在「激活」窗口里填激活码。"}
            </span>
          </div>
        ) : null}
        <header className="topbar">
          {/* 展开时「收起」只在侧栏底部那一个；收起后（或手机上）这个按钮才是回来的路 */}
          {narrow || collapsed ? (
            <button
              className={cn("btn btn-icon btn-ghost topbar-menu", collapsed && "attention")}
              onClick={toggleNav}
              aria-label={narrow ? (navOpen ? "收起菜单" : "打开菜单") : "展开侧边栏"}
              aria-expanded={narrow ? navOpen : !collapsed}
              title={narrow ? "菜单" : "展开侧边栏（Ctrl+B）"}
            >
              <Icon name="panel" size={18} />
            </button>
          ) : null}
          <div className="topbar-crumb">
            <span className="topbar-app">课后服务管理</span>
            <i className="crumb-sep" />
            <b>{titleOf(pathname)}</b>
          </div>

          <button className="topbar-search" onClick={() => setSearchOpen(true)} aria-label="搜索">
            <Icon name="search" size={15} />
            <span className="topbar-search-text">搜索学生、教案…</span>
            <kbd className="kbd topbar-search-kbd">⌘K</kbd>
          </button>

          <div className="topbar-actions">
            <div className="topbar-new">
              <Menu
                align="right"
                trigger={
                  <button className="btn btn-primary btn-sm topbar-new-btn" aria-label="新建">
                    <Icon name="plus" size={15} />
                    <span className="topbar-new-text">新建</span>
                  </button>
                }
              >
                {(close) => (
                  <>
                    <MenuItem
                      icon="calendar"
                      onClick={() => {
                        close();
                        window.location.href = "/calendar?new=1";
                      }}
                    >
                      排一节课
                    </MenuItem>
                    <MenuItem
                      icon="book"
                      onClick={() => {
                        close();
                        window.location.href = "/calendar";
                      }}
                    >
                      去记一笔（今天的课）
                    </MenuItem>
                    <MenuItem
                      icon="wallet"
                      onClick={() => {
                        close();
                        window.location.href = "/finance?new=1";
                      }}
                    >
                      收一笔钱
                    </MenuItem>
                    <MenuItem
                      icon="users"
                      onClick={() => {
                        close();
                        window.location.href = "/students?new=1";
                      }}
                    >
                      加一个学生
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => setHelpOpen(true)}
              aria-label="快捷键说明"
              title="快捷键说明（按 ? 打开）"
            >
              <Icon name="info" size={17} />
            </button>
            <button
              className="btn btn-icon btn-ghost topbar-theme-btn"
              onClick={() => {
                // 一下切换浅色/深色；想「跟随系统」在设置页的「外观」里选
                const next = theme === "dark" ? "light" : "dark";
                pickTheme(next);
              }}
              aria-label="切换主题"
              title={theme === "dark" ? "切到浅色" : "切到深色"}
              style={{ opacity: themeReady ? 1 : 0 }}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
            <span className="topbar-date">{dateLabel}</span>
          </div>
        </header>

        <main className="content">
          <div className="page-enter" key={pathname}>
            {children}
          </div>
        </main>
      </div>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="快捷键与常用操作">
        <div className="kbd-help">
          {SHORTCUTS.map((s) => (
            <div className="kbd-row" key={s.keys + s.what}>
              <span className="kbd-keys">
                {s.keys.split("+").map((k) => (
                  <kbd className="kbd" key={k}>
                    {k.trim()}
                  </kbd>
                ))}
              </span>
              <span className="kbd-what">{s.what}</span>
            </div>
          ))}
        </div>
        <p className="kbd-foot">
          点开顶栏的「＋」能直接排一节课、记一笔、收一笔钱；手机上这个入口在右下角的圆按钮。
        </p>
      </Modal>

      {action ? (
        // 用硬跳转而不是 <Link>：`?new=1` 是靠页面加载时读 search 打开的，
        // 同一个页面软跳只改 query 不会重新挂载，点了会没反应（手机上尤其容易踩到）。
        <button
          type="button"
          className="fab"
          aria-label={action.label}
          title={action.label}
          onClick={() => {
            window.location.href = action.href;
          }}
        >
          <Icon name="plus" size={22} />
        </button>
      ) : null}

      <nav className="tabbar" aria-label="主导航">
        <div className="tabbar-inner">
          {TABBAR.map((l) => {
            const active = isActive(pathname, l);
            return (
              <Link key={l.href} href={l.href} className={cn("tabbar-item", active && "active")}>
                <Icon name={l.icon} size={20} strokeWidth={active ? 2.1 : 1.8} />
                <span>{l.label}</span>
              </Link>
            );
          })}
          <button
            className="tabbar-item"
            onClick={() => setNavOpen(true)}
            aria-label="更多"
            style={{ border: 0, background: "transparent" }}
          >
            <Icon name="menu" size={20} />
            <span>更多</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
