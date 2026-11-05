"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Btn } from "@/components/ui";
import { MANUAL, MANUAL_META, MANUAL_TOC } from "@/lib/manual";
import { AUTHOR_NAME, AUTHOR_URL } from "@/lib/author";

/** 正文里的 `代码` 与 **加粗**：不引第三方 markdown，两种就够了 */
function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null = null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    } else {
      out.push(
        <code key={k++} className="manual-code">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function ManualPage() {
  const [active, setActive] = useState(MANUAL_TOC[0]?.id ?? "");

  // 目录高亮：滚到哪一节就点亮哪一条
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-sec]"));
    if (nodes.length === 0) return;
    const onScroll = () => {
      const line = window.scrollY + 140;
      let cur = nodes[0].dataset.sec ?? "";
      for (const n of nodes) {
        if (n.offsetTop <= line) cur = n.dataset.sec ?? cur;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function jump(id: string) {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <div className="manual-top">
        <div>
          <div className="manual-top-meta">
            {MANUAL_META.name} 使用说明 · v{MANUAL_META.version} · 更新于 {MANUAL_META.updated} ·
            写给「{MANUAL_META.audience}」
          </div>
          <div className="manual-credit">
            制作 ·{" "}
            <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
              {AUTHOR_NAME}
            </a>
            <span className="manual-credit-hint">（点开主页，功能有想法可以直接找我）</span>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }} className="no-print">
          <Btn icon="printer" onClick={() => window.print()} title="打印或另存为 PDF">
            打印 / 存 PDF
          </Btn>
        </div>
      </div>

      <div className="manual-grid">
        <nav className="manual-toc no-print" aria-label="目录">
          <div className="manual-toc-head">目录</div>
          {MANUAL_TOC.map((t) => (
            <a
              key={t.id}
              href={`#sec-${t.id}`}
              className={active === t.id ? "on" : undefined}
              onClick={(e) => {
                e.preventDefault();
                jump(t.id);
              }}
            >
              {t.no}. {t.title}
            </a>
          ))}
        </nav>

        <div className="manual-body">
          {MANUAL.map((s, i) => (
            <section key={s.id} id={`sec-${s.id}`} data-sec={s.id} className="manual-sec">
              <h2>
                <span className="manual-sec-num">{i + 1}.</span>
                {s.title}
              </h2>
              {s.intro ? <div className="manual-sec-intro">{rich(s.intro)}</div> : null}

              {s.blocks.map((b, bi) => {
                if (b.kind === "h3") return <h3 key={bi}>{rich(b.text)}</h3>;
                if (b.kind === "p")
                  return (
                    <p key={bi} className="manual-p">
                      {rich(b.text)}
                    </p>
                  );
                if (b.kind === "note")
                  return (
                    <div key={bi} className="manual-note">
                      <Icon name="info" size={15} />
                      <div>{rich(b.text)}</div>
                    </div>
                  );
                if (b.kind === "steps")
                  return (
                    <ol key={bi} className="manual-steps">
                      {b.items.map((t, ti) => (
                        <li key={ti}>{rich(t)}</li>
                      ))}
                    </ol>
                  );
                if (b.kind === "list")
                  return (
                    <ul key={bi} className="manual-list">
                      {b.items.map((t, ti) => (
                        <li key={ti}>{rich(t)}</li>
                      ))}
                    </ul>
                  );
                return (
                  <table key={bi} className="manual-table">
                    <thead>
                      <tr>
                        {b.head.map((h, hi) => (
                          <th key={hi}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((c, ci) => (
                            <td key={ci}>{rich(c)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })}
            </section>
          ))}

          <div className="manual-sec">
            <div className="manual-p" style={{ color: "var(--ink-3)" }}>
              手册看完了还有不懂的，就在「接口说明」和「使用说明」之间来回翻一翻——所有页面上的按钮，这里都写过一遍。
              手册随版本更新，看到哪条和界面对不上，说明那页该改了。
            </div>
            <div className="manual-sign">
              <span>
                {MANUAL_META.name} v{MANUAL_META.version} · 更新于 {MANUAL_META.updated}
              </span>
              <span>
                制作 <b>{AUTHOR_NAME}</b>
              </span>
              <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
                {AUTHOR_URL.replace(/^https?:\/\//, "")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
