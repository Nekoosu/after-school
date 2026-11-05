"use client";

import { useState } from "react";
import { post } from "@/lib/client";
import { Modal, Btn, Field } from "./ui";
import { Icon } from "./icons";

type Scope = "plans" | "classes" | "students";

interface Report {
  ok: boolean;
  dryRun: boolean;
  created: number;
  skipped: number;
  courseCreated: number;
  errors: { index: number; name: string; reason: string }[];
}

/**
 * 导入小弹窗：贴 JSON → 先检查 → 再确认。
 * 永远先跑一遍 dryRun，让人看清楚会新增多少、跳过多少，再落库。
 */
export function ImportModal({
  open,
  onClose,
  scope,
  title,
  hint,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  title: string;
  hint?: string;
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"" | "check" | "commit">("");
  const [err, setErr] = useState("");

  function reset() {
    setText("");
    setRep(null);
    setErr("");
    setBusy(false);
    setStage("");
  }

  function close() {
    reset();
    onClose();
  }

  function parseRows(): unknown[] | null {
    setErr("");
    const raw = text.trim();
    if (!raw) {
      setErr("先把导出的 JSON 贴进来");
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      setErr("这不是合法的 JSON。把导出文件用记事本打开，全部内容复制过来。");
      return null;
    }
    // 支持三种贴法：整个导出文件 / {rows:[...]} / 直接是数组
    const rows = Array.isArray(data) ? data : (data as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) {
      setErr("没找到 rows 数组。要贴的是导出文件里的 rows。");
      return null;
    }
    return rows;
  }

  async function check() {
    const rows = parseRows();
    if (!rows) return;
    setBusy(true);
    setStage("check");
    try {
      const r = await post<Report>("/api/import", { scope, rows, dryRun: true });
      setRep(r);
    } catch (e) {
      setErr((e as Error).message);
      setRep(null);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function commit() {
    const rows = parseRows();
    if (!rows) return;
    setBusy(true);
    setStage("commit");
    try {
      const r = await post<Report>("/api/import", { scope, rows, dryRun: false });
      setRep({ ...r, dryRun: false });
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const done = rep && !rep.dryRun;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      wide
      footer={
        <>
          <Btn onClick={close}>{done ? "关掉" : "取消"}</Btn>
          {!done && (
            <>
              <Btn icon="eye" onClick={check} loading={busy && stage === "check"}>
                检查一下
              </Btn>
              <Btn
                variant="primary"
                icon="upload"
                onClick={commit}
                loading={busy && stage === "commit"}
                disabled={!rep}
              >
                确认导入 {rep ? `（${rep.created} 条）` : ""}
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <p className="muted fs-sm" style={{ margin: 0 }}>
          {hint ?? "把导出的 JSON 文件内容整个贴进来。同名的一律跳过，不会覆盖已有数据。"}
        </p>

        <Field label="JSON">
          <textarea
            className="textarea mono"
            rows={9}
            style={{ fontSize: 12 }}
            placeholder='{"rows":[{"title":"…","content":"…"}]}'
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRep(null);
              setErr("");
            }}
          />
        </Field>

        {err && <div className="error-box">{err}</div>}

        {rep && (
          <div className={rep.errors.length > 0 ? "warn-box" : "ok-box"}>
            <div className="row wrap" style={{ gap: 14, alignItems: "baseline" }}>
              <strong>{rep.dryRun ? "检查结果（还没写进库）" : "导入完成"}</strong>
              <span>
                新增 <b>{rep.created}</b> 条
              </span>
              {rep.skipped > 0 && <span className="muted">跳过重名 {rep.skipped} 条</span>}
              {rep.courseCreated > 0 && <span className="muted">顺手建了 {rep.courseCreated} 门课程</span>}
            </div>
            {rep.errors.length > 0 && (
              <ul className="fs-sm" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {rep.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>
                    {e.name}：{e.reason}
                  </li>
                ))}
                {rep.errors.length > 8 && <li>…还有 {rep.errors.length - 8} 条</li>}
              </ul>
            )}
            {rep.dryRun && rep.created > 0 && (
              <p className="muted fs-xs" style={{ margin: "8px 0 0" }}>
                确认没问题就点「确认导入」。这一步只是试算，什么都没改。
              </p>
            )}
          </div>
        )}

        <p className="muted fs-xs" style={{ margin: 0 }}>
          <Icon name="info" size={13} /> 导入只认 JSON；CSV 是拿来给人看和给 Excel 的。
        </p>
      </div>
    </Modal>
  );
}
