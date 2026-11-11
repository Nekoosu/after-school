"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    setNavOpen(false);
    setSearchOpen(false);
  }, [pathname]);

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

  // 主题：先看本地存的，没存过就跟系统走
  useEffect(() => {
    const saved = localStorage.getItem("as-theme");
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const initial: "light" | "dark" = saved === "dark" || saved === "light" ? saved : dark ? "dark" : "light";
    document.documentElement.dataset.theme = initial;
    setTheme(initial);
    setThemeReady(true);
    setDateLabel(todayLabel());
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("as-theme", next);
    setTheme(next);
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

  // PWA：注册一个不缓存的 service worker，手机上才能「添加到主屏幕」
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
            <b>{titleOf(pathname)}</b>
          </div>

          <button className="topbar-search" onClick={() => setSearchOpen(true)} aria-label="搜索">
            <Icon name="search" size={15} />
            <span className="topbar-search-text">搜索学生、教案…</span>
            <kbd className="kbd topbar-search-kbd">⌘K</kbd>
          </button>

          <div className="topbar-actions">
            <button
              className="btn btn-icon btn-ghost"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}
              title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              style={{ opacity: themeReady ? 1 : 0 }}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
            <span className="topbar-date">{dateLabel}</span>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

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
