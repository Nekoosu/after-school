"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { cn, avatarColor, initial } from "@/lib/format";

/* ============================================================
   Toast
   ============================================================ */
type ToastKind = "ok" | "bad" | "info";
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}
interface ToastApi {
  ok: (msg: string) => void;
  bad: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastCtx = createContext<ToastApi>({
  ok: () => {},
  bad: () => {},
  info: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((msg: string, kind: ToastKind) => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, msg, kind }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 2800);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      ok: (m) => push(m, "ok"),
      bad: (m) => push(m, "bad"),
      info: (m) => push(m, "info"),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={cn("toast", t.kind)}>
            <Icon
              name={t.kind === "ok" ? "check" : t.kind === "bad" ? "alert" : "info"}
              size={15}
              strokeWidth={2.4}
            />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

/* ============================================================
   卡片 / 区块
   ============================================================ */
export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("card", className)} style={style}>
      {children}
    </div>
  );
}

export function CardHead({
  title,
  sub,
  actions,
  icon,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="card-head">
      {icon && <Icon name={icon} size={16} style={{ color: "var(--ink-3)" }} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="card-title">{title}</div>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="card-actions">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  count,
  actions,
  children,
  mt,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  mt?: boolean;
}) {
  return (
    <section className="section" style={mt ? { marginTop: 26 } : undefined}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {count !== undefined && count !== null ? <span className="section-count">{count}</span> : null}
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ============================================================
   按钮
   ============================================================ */
type BtnVariant = "default" | "primary" | "ghost" | "danger" | "soft";

export function Btn({
  children,
  variant = "default",
  size,
  icon,
  loading,
  block,
  className,
  ...rest
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  size?: "sm" | "lg";
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "danger" && "btn-danger",
        variant === "soft" && "btn-soft",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        block && "btn-block",
        className,
      )}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconBtn({
  icon,
  label,
  size,
  variant = "ghost",
  ...rest
}: {
  icon: IconName;
  label: string;
  size?: "sm" | "lg";
  variant?: BtnVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "btn btn-icon",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "danger" && "btn-danger",
        variant === "soft" && "btn-soft",
        size === "sm" && "btn-sm",
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 15 : 17} />
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      style={{ animation: "spin 0.8s linear infinite" }}
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </svg>
  );
}

/* ============================================================
   徽章
   ============================================================ */
export function Badge({
  children,
  tone = "default",
  dot,
  className,
}: {
  children: ReactNode;
  tone?:
    | "default"
    | "ok"
    | "warn"
    | "bad"
    | "brand"
    | "violet"
    | "cyan"
    | "outline"
    | "present"
    | "leave"
    | "absent"
    | "makeup"
    | "done"
    | "planned"
    | "cancelled"
    | "draft"
    | "sent"
    | "active"
    | "left";
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("badge", `badge-${tone}`, className)}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

/* ============================================================
   统计卡
   ============================================================ */
export function Stat({
  label,
  value,
  unit,
  foot,
  icon,
  tone,
  href,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
  icon?: IconName;
  tone?: "ok" | "warn" | "bad" | "violet" | "cyan";
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {icon && (
        <div className={cn("stat-icon", tone)}>
          <Icon name={icon} size={16} />
        </div>
      )}
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </>
  );

  if (href) {
    return (
      <a className="stat clickable" href={href}>
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <div className="stat clickable" onClick={onClick} role="button" tabIndex={0}>
        {inner}
      </div>
    );
  }
  return <div className="stat">{inner}</div>;
}

/* ============================================================
   头像
   ============================================================ */
export function Avatar({
  name,
  size = "md",
}: {
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={cn("avatar", size !== "md" && size)}
      style={{ background: avatarColor(name) }}
      aria-hidden="true"
    >
      {initial(name)}
    </span>
  );
}

/* ============================================================
   Tabs
   ============================================================ */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          className={cn("tab", value === it.key && "on")}
          onClick={() => onChange(it.key)}
        >
          {it.label}
          {it.count !== undefined ? <span className="cnt">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="segmented">
      {items.map((it) => (
        <button key={it.key} className={cn(value === it.key && "on")} onClick={() => onChange(it.key)}>
          {it.icon && <Icon name={it.icon} size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   空态 / 骨架
   ============================================================ */
export function Empty({
  icon = "coffee",
  title = "这里还空着",
  text,
  action,
}: {
  icon?: IconName;
  title?: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="empty-title">{title}</div>
      {text ? <div className="empty-text">{text}</div> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  w,
  h = 13,
  style,
}: {
  w?: number | string;
  h?: number;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Skeleton w={30} h={30} style={{ borderRadius: "50%", flex: "none" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton w={`${58 + ((i * 13) % 30)}%`} />
            <Skeleton w={`${30 + ((i * 7) % 24)}%`} h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageLoading({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="empty" style={{ padding: "60px 20px" }}>
      <Spinner size={20} />
      <div className="empty-text">{text}</div>
    </div>
  );
}

/* ============================================================
   弹窗 / 抽屉
   ============================================================ */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const mounted = useMounted();
  // onClose 多半是内联箭头函数，每次渲染都换身份；放进依赖会让下面的 effect
  // 每敲一个字就跑一遍（body 的 overflow 被反复清空再设回，滚动条来回闪）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn("modal", wide && "wide")} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title grow">{title}</div>
          <IconBtn icon="x" label="关闭" size="sm" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const mounted = useMounted();
  // onClose 多半是内联箭头函数，每次渲染都换身份；放进依赖会让下面的 effect
  // 每敲一个字就跑一遍（body 的 overflow 被反复清空再设回，滚动条来回闪）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title grow">{title}</div>
          <IconBtn icon="x" label="关闭" size="sm" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** 二次确认弹窗（比 window.confirm 好看，且能写清后果） */
export function Confirm({
  open,
  title,
  text,
  confirmText = "确定",
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Btn onClick={onClose}>取消</Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)" }}>{text}</div>
    </Modal>
  );
}

/* ============================================================
   下拉菜单
   ============================================================ */
export function Menu({
  trigger,
  children,
  align = "right",
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className="menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  danger,
  onClick,
}: {
  icon?: IconName;
  children: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={cn("menu-item", danger && "danger")} onClick={onClick} role="menuitem">
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
    </div>
  );
}

export function MenuSep() {
  return <div className="menu-sep" />;
}

/* ============================================================
   表单件
   ============================================================ */
export function Field({
  label,
  hint,
  required,
  children,
  span2,
}: {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={cn("field", span2 && "span2")} style={span2 ? { gridColumn: "span 2" } : undefined}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索…",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="search" style={style}>
      <Icon name="search" size={15} />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={cn("switch", on && "on")}
      onClick={() => onChange(!on)}
      aria-label={label}
      aria-pressed={on}
    />
  );
}

export function Progress({ value, tone }: { value: number; tone?: "ok" | "warn" | "bad" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress">
      <i className={tone} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ============================================================
   工具：把「键值对」渲染成定义列表
   ============================================================ */
export function InfoGrid({ items }: { items: Array<{ k: string; v: ReactNode }> }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "10px 18px",
      }}
    >
      {items.map((it) => (
        <div key={it.k}>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 1 }}>{it.k}</div>
          <div style={{ fontSize: 13.5 }}>{it.v || <span className="dim">—</span>}</div>
        </div>
      ))}
    </div>
  );
}
