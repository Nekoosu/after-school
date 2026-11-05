"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icons";
import { cn } from "@/lib/format";

interface Hit {
  id: number;
  name?: string;
  title?: string;
  grade?: string | null;
  guardian_phone?: string | null;
  subject?: string | null;
  topic?: string | null;
  start_at?: string;
  course_name?: string;
}

interface SearchResult {
  students: Hit[];
  courses: Hit[];
  plans: Hit[];
  lessons: Hit[];
}

const EMPTY: SearchResult = { students: [], courses: [], plans: [], lessons: [] };

interface Item {
  key: string;
  group: string;
  icon: IconName;
  title: string;
  sub: string;
  href: string;
}

function toItems(d: SearchResult): Item[] {
  const out: Item[] = [];
  for (const s of d.students) {
    out.push({
      key: `s${s.id}`,
      group: "学生",
      icon: "user",
      title: s.name ?? "",
      sub: [s.grade, s.guardian_phone].filter(Boolean).join(" · ") || "学生档案",
      href: `/students/${s.id}`,
    });
  }
  for (const c of d.courses) {
    out.push({
      key: `c${c.id}`,
      group: "课程",
      icon: "cap",
      title: c.name ?? "",
      sub: c.subject || "按课程看课表",
      href: `/calendar?course=${c.id}`,
    });
  }
  for (const p of d.plans) {
    out.push({
      key: `p${p.id}`,
      group: "教案",
      icon: "book",
      title: p.title ?? "",
      sub: p.topic || "教案",
      href: `/plans?q=${encodeURIComponent(p.title ?? "")}`,
    });
  }
  for (const l of d.lessons) {
    out.push({
      key: `l${l.id}`,
      group: "课程记录",
      icon: "calendar",
      title: l.title || l.course_name || "",
      sub: [l.start_at, l.course_name].filter(Boolean).join(" · "),
      href: `/lessons/${l.id}`,
    });
  }
  return out;
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setData(EMPTY);
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : EMPTY))
        .then((d: Partial<SearchResult>) => {
          setData({ ...EMPTY, ...d });
          setCursor(0);
        })
        .catch(() => setData(EMPTY))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [q, open]);

  const items = useMemo(() => toItems(data), [data]);

  function go(item: Item) {
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (items.length ? (c + 1) % items.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item) go(item);
    }
  }

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <Icon name="search" size={17} className="palette-ico" />
          <input
            ref={inputRef}
            className="palette-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜学生、课程、教案、课程记录…"
            spellCheck={false}
          />
          {loading ? <span className="palette-loading">搜索中…</span> : null}
          <button className="palette-esc" onClick={onClose} aria-label="关闭">
            Esc
          </button>
        </div>

        <div className="palette-list">
          {!q.trim() ? (
            <div className="palette-tip">
              <Icon name="sparkles" size={15} />
              <span>输入姓名、年级、家长电话、课程名、教案关键词都行</span>
            </div>
          ) : items.length === 0 ? (
            <div className="palette-tip">
              <Icon name="search" size={15} />
              <span>{loading ? "正在找…" : `没找到「${q.trim()}」，换个词试试`}</span>
            </div>
          ) : (
            items.map((it, i) => {
              const head = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <div key={it.key}>
                  {head ? <div className="palette-group">{head}</div> : null}
                  <button
                    className={cn("palette-item", i === cursor && "on")}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(it)}
                  >
                    <span className="palette-item-ico">
                      <Icon name={it.icon} size={15} />
                    </span>
                    <span className="palette-item-main">
                      <span className="palette-item-title">{it.title}</span>
                      <span className="palette-item-sub">{it.sub}</span>
                    </span>
                    <Icon name="arrowRight" size={14} className="palette-item-go" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> 选择
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> 打开
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
