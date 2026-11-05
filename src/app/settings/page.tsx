"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { ApiCard } from "@/components/ApiCard";
import { ImportModal } from "@/components/ImportModal";
import { Btn, Card, CardHead, Confirm, Field, PageLoading, Section, useToast } from "@/components/ui";
import { api, del, patch, post } from "@/lib/client";
import { toHours, weekdayLabel } from "@/lib/format";
import { API_VERSION, APP_VERSION } from "@/lib/version";
import { AUTHOR_NAME, AUTHOR_URL } from "@/lib/author";

const DURATIONS = [45, 60, 90, 120, 150];
const THRESHOLDS = [180, 270, 360, 450, 540, 720];

/** 页面加载时的当天日期（YYYY-MM-DD），用来判断「今天备份了吗」 */
const ISO_TODAY = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

interface SettingsMap {
  [k: string]: string;
}

interface BackupFile {
  name: string;
  size: number;
  mtime: string;
  kind: "auto" | "manual";
}

function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function timeText(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<SettingsMap | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [bk, setBk] = useState<{ dir: string; files: BackupFile[]; total: number } | null>(null);
  const [bkBusy, setBkBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [delFile, setDelFile] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importScope, setImportScope] = useState<null | "students" | "plans" | "classes">(null);
  const [aiTest, setAiTest] = useState<{ busy: boolean; ok: boolean; msg: string }>({ busy: false, ok: false, msg: "" });
  // 「自动获取模型名」：拉一次 /models，把可选值放进 datalist
  const [modelsBusy, setModelsBusy] = useState(false);
  const [aiModels, setAiModels] = useState<string[]>([]);

  async function fetchModels() {
    if (!s) return;
    setModelsBusy(true);
    try {
      const r = await post<{ ok: boolean; models?: string[]; error?: string }>("/api/ai/models", {
        base: s.ai_base ?? "",
        key: s.ai_key ?? "",
      });
      if (r.ok && r.models && r.models.length > 0) {
        setAiModels(r.models);
        // 没填过或填的不在列表里，就自动选第一个
        if (!r.models.includes(s.ai_model ?? "")) set("ai_model", r.models[0]);
        toast.ok(`拿到 ${r.models.length} 个模型名，已选「${r.models[0]}」`);
      } else {
        toast.bad(r.error ?? "没拿到模型名");
      }
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setModelsBusy(false);
    }
  }

  const loadBackups = useCallback(async () => {
    try {
      setBk(await api<{ dir: string; files: BackupFile[]; total: number }>("/api/backup/list"));
    } catch (e) {
      toast.bad((e as Error).message);
    }
  }, [toast]);

  useEffect(() => {
    api<SettingsMap>("/api/settings")
      .then(setS)
      .catch((e: Error) => toast.bad(e.message));
    loadBackups();
  }, [toast, loadBackups]);

  async function backupNow() {
    setBkBusy(true);
    try {
      const r = await post<{ file: BackupFile; files: BackupFile[] }>("/api/backup/list", {});
      setBk((old) => (old ? { ...old, files: r.files } : old));
      toast.ok(`已备份：${r.file.name}`);
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBkBusy(false);
    }
  }

  async function doRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const r = await post<{ restoredFrom: string; safetyBackup: string; students: number }>("/api/restore", {
        file: restoreFile,
      });
      toast.ok(`已恢复到 ${r.restoredFrom}（${r.students} 个学生），页面马上刷新`);
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      toast.bad((e as Error).message);
      setRestoring(false);
    }
  }

  /** 恢复确认框里展示的那一份 */
  const pick = bk?.files.find((f) => f.name === restoreFile) ?? null;
  /** 删除确认框里展示的那一份 */
  const delPick = bk?.files.find((f) => f.name === delFile) ?? null;

  async function doDeleteBackup() {
    if (!delFile) return;
    setDeleting(true);
    try {
      const r = await del<{ removed: string; left: number; freed: number }>(
        `/api/backup?file=${encodeURIComponent(delFile)}`,
      );
      toast.ok(`已删掉 ${r.removed}，省出 ${sizeText(r.freed)}，还剩 ${r.left} 份`);
      setDelFile(null);
      await loadBackups();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function set(k: string, v: string) {
    setS((old) => (old ? { ...old, [k]: v } : old));
    setDirty(true);
  }

  async function testAi() {
    if (!s) return;
    setAiTest({ busy: true, ok: false, msg: "" });
    try {
      const r = await post<{ ok: boolean; reply?: string; error?: string; model?: string }>("/api/ai", {
        base: s.ai_base ?? "",
        model: s.ai_model ?? "",
        key: s.ai_key ?? "",
      });
      setAiTest({
        busy: false,
        ok: r.ok,
        msg: r.ok ? `连上了，模型 ${r.model ?? ""} 回复「${r.reply ?? "ok"}」` : (r.error ?? "连不上"),
      });
    } catch (e) {
      setAiTest({ busy: false, ok: false, msg: (e as Error).message });
    }
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await patch("/api/settings", {
        org_name: s.org_name ?? "",
        org_phone: s.org_phone ?? "",
        org_address: s.org_address ?? "",
        teacher_name: s.teacher_name ?? "",
        lesson_default_minutes: s.lesson_default_minutes ?? "90",
        low_balance_minutes: s.low_balance_minutes ?? "450",
        week_start: s.week_start ?? "1",
        ai_enabled: s.ai_enabled ?? "0",
        ai_base: s.ai_base ?? "",
        ai_model: s.ai_model ?? "",
        ai_key: s.ai_key ?? "",
        feedback_tone: s.feedback_tone ?? "plain",
      });
      toast.ok("设置已保存");
      setDirty(false);
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** 学生名单导出 CSV（纯前端拼，不经过服务端） */
  async function exportStudents() {
    try {
      const rows = await api<Array<Record<string, unknown>>>("/api/students");
      const head = ["姓名", "年级", "学校", "家长", "电话", "微信", "剩余小时", "状态"];
      const lines = rows.map((r) =>
        [
          r.name,
          r.grade ?? "",
          r.school ?? "",
          r.guardian_name ?? "",
          r.guardian_phone ?? "",
          r.guardian_wechat ?? "",
          toHours(Number(r.balance_minutes ?? 0)),
          r.status === "active" ? "在读" : "已离开",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
      const csv = "\uFEFF" + [head.join(","), ...lines].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `学生名单-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.ok(`导出了 ${rows.length} 个学生`);
    } catch (e) {
      toast.bad((e as Error).message);
    }
  }

  if (!s) return <PageLoading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">机构信息、上课默认值、数据备份。改完记得点保存。</p>
        </div>
        <div className="page-head-actions">
          {dirty && <span className="muted fs-sm">有未保存的修改</span>}
          <Btn variant="primary" icon="save" loading={saving} onClick={save} disabled={!dirty}>
            保存设置
          </Btn>
        </div>
      </div>

      <div className="grid g2">
        <Card>
          <CardHead title="机构信息" icon="home" sub="显示在侧栏和反馈落款里" />
          <div className="card-body">
            <div className="form-grid">
              <Field label="机构名称" span2>
                <input className="input" value={s.org_name ?? ""} onChange={(e) => set("org_name", e.target.value)} placeholder="如 天凉课后服务中心" />
              </Field>
              <Field label="老师称呼">
                <input className="input" value={s.teacher_name ?? ""} onChange={(e) => set("teacher_name", e.target.value)} placeholder="如 王老师" />
              </Field>
              <Field label="联系电话">
                <input className="input" value={s.org_phone ?? ""} onChange={(e) => set("org_phone", e.target.value)} placeholder="可选" />
              </Field>
              <Field label="地址" span2>
                <input className="input" value={s.org_address ?? ""} onChange={(e) => set("org_address", e.target.value)} placeholder="可选" />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="上课默认值" icon="clock" sub="排课和提醒会用这些数" />
          <div className="card-body">
            <div className="form-grid">
              <Field label="默认课时长度" hint="排课时自动带出">
                <select className="select" value={s.lesson_default_minutes ?? "90"} onChange={(e) => set("lesson_default_minutes", e.target.value)}>
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} 分钟
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="课时不足提醒" hint={`低于 ${toHours(Number(s.low_balance_minutes ?? 450))} 小时就标红`}>
                <select className="select" value={s.low_balance_minutes ?? "450"} onChange={(e) => set("low_balance_minutes", e.target.value)}>
                  {THRESHOLDS.map((d) => (
                    <option key={d} value={d}>
                      {toHours(d)} 小时（{d} 分钟）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="每周从哪天开始" span2>
                <select className="select" value={s.week_start ?? "1"} onChange={(e) => set("week_start", e.target.value)}>
                  {[1, 0, 6].map((d) => (
                    <option key={d} value={d}>
                      {weekdayLabel(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="反馈语气" hint="家长反馈草稿的口吻，AI 润色也会参考" span2>
                <select className="select" value={s.feedback_tone ?? "plain"} onChange={(e) => set("feedback_tone", e.target.value)}>
                  <option value="plain">常规 · 就事论事</option>
                  <option value="warm">亲切 · 多一点人情味</option>
                  <option value="brief">简短 · 只说要点</option>
                </select>
              </Field>
            </div>
            <div className="info-box mt-2">
              <Icon name="info" size={15} />
              课时不足的阈值改了之后，首页和统计页的标红名单会跟着变。
            </div>
          </div>
        </Card>
      </div>

      <Section title="AI 润色（可选）" mt>
        <Card>
          <CardHead
            title="把草稿改得更像人说的话"
            icon="sparkles"
            sub="只改表达，事实和数字仍然来自你记的学情；不填也能用，用的是本地规则草稿"
            actions={
              <Btn size="sm" icon="zap" loading={aiTest.busy} onClick={testAi}>
                测试连接
              </Btn>
            }
          />
          <div className="card-body">
            <div className="form-grid">
              <Field label="启用 AI 润色" hint="关掉就完全离线，不会发出任何请求">
                <select
                  className="select"
                  value={s.ai_enabled ?? "0"}
                  onChange={(e) => set("ai_enabled", e.target.value)}
                >
                  <option value="0">关闭（只用本地草稿）</option>
                  <option value="1">开启</option>
                </select>
              </Field>
              <Field label="模型名" hint="点「自动获取」让接口自己报名字；报不出来也能手填">
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    list="ai-model-options"
                    value={s.ai_model ?? ""}
                    onChange={(e) => set("ai_model", e.target.value)}
                    placeholder="deepseek-chat"
                  />
                  <datalist id="ai-model-options">
                    {aiModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <Btn size="sm" icon="down" loading={modelsBusy} onClick={fetchModels} title="从接口拉一次可用模型名">
                    自动获取
                  </Btn>
                </div>
              </Field>
              <Field
                label="接口地址"
                span2
                hint="OpenAI 兼容地址，一般以 /v1 结尾；本机 Ollama 是 http://127.0.0.1:11434/v1"
              >
                <input className="input mono fs-sm" value={s.ai_base ?? ""} onChange={(e) => set("ai_base", e.target.value)} placeholder="https://api.deepseek.com/v1" />
              </Field>
              <Field label="API Key" span2 hint="存在本机 data/app.db 里，不会上传；本机 Ollama 可以留空">
                <input
                  className="input mono fs-sm"
                  type="password"
                  value={s.ai_key ?? ""}
                  onChange={(e) => set("ai_key", e.target.value)}
                  placeholder="sk-…"
                />
              </Field>
            </div>
            {aiTest.msg && (
              <div className={aiTest.ok ? "ok-box mt-2" : "error-box mt-2"}>
                <Icon name={aiTest.ok ? "check" : "alert"} size={15} />
                {aiTest.msg}
              </div>
            )}
            <div className="info-box mt-2">
              <Icon name="info" size={15} />
              反馈页生成草稿时会先按你记的学情整理，再交给 AI 改写语气。AI 连不上就自动用本地草稿，不会卡住。
            </div>
          </div>
        </Card>
      </Section>

      <Section title="数据" mt>
        <div className="grid g2">
          <Card>
            <CardHead
              title="自动备份"
              icon="database"
              sub="每天第一次打开系统时自动存一份，只保留最近 30 份；↻ 恢复、⬇ 下载、🗑 删掉"
              actions={
                <Btn size="sm" icon="save" loading={bkBusy} onClick={backupNow}>
                  立即备份
                </Btn>
              }
            />
            <div className="card-body">
              <div className="row between" style={{ gap: 12, marginBottom: 12 }}>
                <div className="col" style={{ gap: 2 }}>
                  <span className="fs-xs muted">今天</span>
                  <span className="strong">
                    {bk?.files.some((f) => f.kind === "auto" && f.name.startsWith(`auto-${ISO_TODAY}`))
                      ? "已备份"
                      : "还没备份"}
                  </span>
                </div>
                <div className="col" style={{ gap: 2 }}>
                  <span className="fs-xs muted">共</span>
                  <span className="strong">{bk?.files.length ?? 0} 份</span>
                </div>
                <div className="col" style={{ gap: 2 }}>
                  <span className="fs-xs muted">占用</span>
                  <span className="strong">{sizeText(bk?.total ?? 0)}</span>
                </div>
              </div>

              {bk && bk.files.length > 0 ? (
                <div className="list" style={{ maxHeight: 320, overflowY: "auto" }}>
                  {bk.files.map((f) => (
                    <div className="list-row" key={f.name}>
                      <div className="row-main">
                        <div className="row-title mono fs-sm">{f.name}</div>
                        <div className="row-sub">
                          {timeText(f.mtime)} · {sizeText(f.size)} · {f.kind === "auto" ? "自动" : "手动"}
                        </div>
                      </div>
                      <div className="row-side">
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="恢复到这份备份"
                          disabled={restoring && restoreFile === f.name}
                          onClick={() => setRestoreFile(f.name)}
                        >
                          <Icon name="refresh" size={14} />
                        </button>
                        <a
                          className="btn btn-sm"
                          href={`/api/backup?file=${encodeURIComponent(f.name)}`}
                          title="下载这份"
                        >
                          <Icon name="download" size={14} />
                        </a>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-ghost"
                          title="删掉这份备份"
                          onClick={() => setDelFile(f.name)}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty" style={{ padding: "18px 0" }}>
                  <div className="empty-text">还没有备份，点右上「立即备份」存一份</div>
                </div>
              )}

              <p className="muted fs-xs" style={{ marginBottom: 0 }}>
                备份存在 <span className="mono">{bk?.dir ?? "E:\\after-school\\backups"}</span>
                。恢复：停掉服务，把 .db 改名成 <span className="mono">app.db</span> 放回{" "}
                <span className="mono">data\\</span>。
              </p>
            </div>
          </Card>

          <div className="col" style={{ gap: 16 }}>
            <Card>
              <CardHead title="带走与带回" icon="download" sub="导出去存着，换电脑时再导回来" />
              <div className="card-body">
                <div className="row wrap" style={{ gap: 8 }}>
                  <a className="btn btn-primary btn-sm" href="/api/backup">
                    <Icon name="download" size={15} />
                    下载当前快照
                  </a>
                  <Btn size="sm" icon="file" onClick={exportStudents}>
                    导出学生名单 CSV
                  </Btn>
                  <a className="btn btn-sm" href="/api/export?scope=students&format=csv">
                    <Icon name="download" size={15} />
                    学生名册（带余额）
                  </a>
                  <a className="btn btn-sm" href="/api/export?scope=payments">
                    <Icon name="download" size={15} />
                    收款记录 CSV
                  </a>
                  <a className="btn btn-sm" href="/api/export?scope=records">
                    <Icon name="download" size={15} />
                    上课记录 CSV
                  </a>
                  <a className="btn btn-sm" href="/api/export?scope=plans">
                    <Icon name="download" size={15} />
                    教案 JSON
                  </a>
                  <a className="btn btn-sm" href="/api/export?scope=classes">
                    <Icon name="download" size={15} />
                    班级 JSON
                  </a>
                  <a className="btn btn-sm" href="/api/export">
                    <Icon name="download" size={15} />
                    导出全部数据 JSON
                  </a>
                </div>

                <div className="divider" style={{ margin: "14px 0 12px" }} />

                <div className="row wrap" style={{ gap: 8 }}>
                  <Btn size="sm" icon="upload" onClick={() => setImportScope("students")}>
                    导入学生 JSON
                  </Btn>
                  <Btn size="sm" icon="upload" onClick={() => setImportScope("plans")}>
                    导入教案 JSON
                  </Btn>
                  <Btn size="sm" icon="upload" onClick={() => setImportScope("classes")}>
                    导入班级 JSON
                  </Btn>
                </div>

                <p className="muted fs-xs" style={{ margin: "10px 0 0" }}>
                  快照是数据库文件本身，恢复时直接换回去；JSON 是纯文本，能用记事本打开看，适合留档或搬到别的系统。
                  导入会先试算一遍，同名的不覆盖；整库恢复请用左边「自动备份」里的 ↻ 按钮。
                </p>
              </div>
            </Card>

            <Card>
              <CardHead title="关于" icon="info" sub="本地运行，数据不出这台电脑" />
              <div className="card-body">
                <div className="col" style={{ gap: 8 }}>
                  <div className="row between">
                    <span className="muted">版本</span>
                    <span className="mono fs-sm">
                      {APP_VERSION}（接口 v{API_VERSION}）
                    </span>
                  </div>
                  <div className="row between">
                    <span className="muted">数据文件</span>
                    <span className="mono fs-sm">app\data\app.db</span>
                  </div>
                  <div className="row between">
                    <span className="muted">技术栈</span>
                    <span className="fs-sm">Next.js + SQLite</span>
                  </div>
                  <div className="row between">
                    <span className="muted">启动方式</span>
                    <span className="fs-sm">双击 AfterSchool.exe</span>
                  </div>
                  <div className="row between">
                    <span className="muted">作者</span>
                    <a className="btn btn-sm" href={AUTHOR_URL} target="_blank" rel="noreferrer">
                      {AUTHOR_NAME}
                      <Icon name="external" size={13} />
                    </a>
                  </div>
                  <div className="row between">
                    <span className="muted">怎么用</span>
                    <a className="btn btn-sm" href="/manual">
                      使用说明
                    </a>
                  </div>
                  <div className="row between">
                    <span className="muted">改功能前先看</span>
                    <span className="mono fs-sm">AGENTS.md</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </Section>

      <Section title="对接与接口" mt>
        <ApiCard />
      </Section>

      <Confirm
        open={!!restoreFile}
        title="恢复这份备份？"
        confirmText={restoring ? "正在恢复…" : "确认恢复"}
        danger
        onConfirm={doRestore}
        onClose={() => setRestoreFile(null)}
        text={
          <>
            会把现在所有数据整体换成「{restoreFile}」
            {pick ? `（${timeText(pick.mtime)} · ${sizeText(pick.size)}）` : ""}。
            <br />
            恢复前系统会先把现在的数据另存一份备份，恢复错了还能再换回来。恢复过程中请不要关窗口。
          </>
        }
      />

      <Confirm
        open={!!delFile}
        title="删掉这份备份？"
        confirmText={deleting ? "正在删除…" : "删掉"}
        danger
        onConfirm={doDeleteBackup}
        onClose={() => setDelFile(null)}
        text={
          <>
            会把「{delFile}」{delPick ? `（${timeText(delPick.mtime)} · ${sizeText(delPick.size)}）` : ""}从备份目录里删掉。
            <br />
            删了没法撤回，但这只影响这份快照——现在正在用的数据一个都不动。
          </>
        }
      />

      <ImportModal
        open={importScope === "students"}
        onClose={() => setImportScope(null)}
        scope="students"
        title="导入学生"
        hint="把导出的「学生-….json」用记事本打开，全部内容贴进来。重名的学生会跳过，不覆盖。"
      />
      <ImportModal
        open={importScope === "plans"}
        onClose={() => setImportScope(null)}
        scope="plans"
        title="导入教案"
        hint="把导出的「教案-….json」用记事本打开，全部内容贴进来。同名教案会跳过，不覆盖。"
      />
      <ImportModal
        open={importScope === "classes"}
        onClose={() => setImportScope(null)}
        scope="classes"
        title="导入班级"
        hint="把导出的「班级-….json」用记事本打开，全部内容贴进来。同名班级会跳过，不覆盖。"
      />
    </>
  );
}
