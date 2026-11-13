"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { ImportModal } from "@/components/ImportModal";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  Empty,
  Field,
  PageLoading,
  SearchInput,
  Segmented,
  Modal,
  useDownload,
  useToast,
} from "@/components/ui";
import { api, post } from "@/lib/client";
import { useAutoNew } from "@/lib/autoNew";
import { avatarColor, money, relTime, toHours } from "@/lib/format";

interface StudentRow {
  id: number;
  name: string;
  gender: string | null;
  grade: string | null;
  school: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_wechat: string | null;
  note: string | null;
  tags: string | null;
  status: string;
  joined_at: string | null;
  balance_minutes: number | null;
  balance_hours: number | null;
  last_note_at: string | null;
}

type Filter = "all" | "active" | "low" | "left";
type SortKey = "balance" | "recent" | "name";

interface ParsedRow {
  name: string;
  grade: string;
  guardianPhone: string;
  guardianWechat: string;
}

/** 从粘贴的名单里解析：每行「姓名 年级 电话 微信」，逗号/制表符/分号/空格都认 */
function parseBulk(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts = line.split(/[\t,，;；|]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) parts = line.split(/\s+/).filter(Boolean);
    const name = (parts[0] ?? "").replace(/^["']|["']$/g, "");
    if (!name || name === "姓名" || name === "名字") continue;
    out.push({
      name,
      grade: parts[1] ?? "",
      guardianPhone: (parts[2] ?? "").replace(/[^\d\-+]/g, ""),
      guardianWechat: parts[3] ?? "",
    });
  }
  return out;
}

export default function StudentsPage() {
  const toast = useToast();
  const download = useDownload();
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [sort, setSort] = useState<SortKey>("balance");
  const [view, setView] = useState<"table" | "card">("table");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState("");
  const [threshold, setThreshold] = useState(450);
  const [importOpen, setImportOpen] = useState(false);
  useAutoNew(setOpen); // 顶栏「新建 · 加一个学生」跳 ?new=1，直接把弹层打开
  const [form, setForm] = useState({
    name: "",
    gender: "",
    grade: "",
    school: "",
    guardianName: "",
    guardianPhone: "",
    guardianWechat: "",
    note: "",
  });

  const load = () =>
    api<StudentRow[]>("/api/students")
      .then(setRows)
      .catch((e: Error) => toast.bad(e.message));

  useEffect(() => {
    load();
    api<Record<string, string>>("/api/settings")
      .then((s) => setThreshold(Number(s.low_balance_minutes || 450)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("new=1")) setOpen(true);
  }, []);

  const list = useMemo(() => {
    if (!rows) return [];
    let out = rows.filter((r) => {
      if (filter === "active") return r.status === "active";
      if (filter === "left") return r.status === "left";
      if (filter === "low") return r.status === "active" && (r.balance_minutes ?? 0) < threshold;
      return true;
    });
    const kw = q.trim();
    if (kw) {
      out = out.filter((r) =>
        [r.name, r.grade, r.school, r.guardian_name, r.guardian_phone, r.tags, r.note]
          .filter(Boolean)
          .some((v) => String(v).includes(kw)),
      );
    }
    const sorted = [...out];
    if (sort === "balance") sorted.sort((a, b) => (a.balance_minutes ?? 0) - (b.balance_minutes ?? 0));
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    if (sort === "recent")
      sorted.sort((a, b) => String(b.last_note_at ?? "").localeCompare(String(a.last_note_at ?? "")));
    return sorted;
  }, [rows, q, filter, sort, threshold]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      all: r.length,
      active: r.filter((x) => x.status === "active").length,
      low: r.filter((x) => x.status === "active" && (x.balance_minutes ?? 0) < threshold).length,
      left: r.filter((x) => x.status === "left").length,
    };
  }, [rows, threshold]);

  async function submit() {
    if (!form.name.trim()) {
      toast.bad("请填写学生姓名");
      return;
    }
    setSaving(true);
    try {
      await post("/api/students", form);
      toast.ok(`已添加 ${form.name}`);
      setOpen(false);
      setForm({
        name: "",
        gender: "",
        grade: "",
        school: "",
        guardianName: "",
        guardianPhone: "",
        guardianWechat: "",
        note: "",
      });
      await load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function doImport() {
    const parsed = parseBulk(bulkText);
    if (parsed.length === 0) {
      setBulkErr("没解析出名字，每行第一列要是姓名");
      return;
    }
    setBulkBusy(true);
    setBulkErr("");
    let done = 0;
    const fails: string[] = [];
    for (const p of parsed) {
      try {
        await post("/api/students", p);
        done += 1;
      } catch (e) {
        fails.push(`${p.name}：${(e as Error).message}`);
      }
    }
    setBulkBusy(false);
    if (done > 0) toast.ok(`导入 ${done} 人${fails.length ? `，${fails.length} 人没成功` : ""}`);
    else toast.bad("一个都没导入成功");
    if (fails.length > 0) {
      setBulkErr(fails.join("\n"));
    } else {
      setBulkOpen(false);
      setBulkText("");
    }
    await load();
  }

  if (!rows) return <PageLoading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">学生</h1>
          <p className="page-sub">
            在读 {counts.active} 人{counts.low ? `　·　${counts.low} 人课时不足` : ""}
          </p>
        </div>
        <div className="page-head-actions">
          <Btn
            icon="download"
            onClick={() => download("/api/export?scope=students&format=csv", "学生名册.csv")}
          >
            导出名册
          </Btn>
          <Btn icon="upload" onClick={() => setBulkOpen(true)}>
            批量导入
          </Btn>
          <Btn icon="plus" variant="primary" onClick={() => setOpen(true)}>
            新学生
          </Btn>
        </div>
      </div>

      <Card>
        <div className="row wrap" style={{ gap: 10, padding: "12px 14px" }}>
          <SearchInput value={q} onChange={setQ} placeholder="搜姓名、年级、家长电话" style={{ maxWidth: 260 }} />
          <Segmented
            items={[
              { key: "active", label: `在读 ${counts.active}` },
              { key: "low", label: `课时不足 ${counts.low}` },
              { key: "all", label: `全部 ${counts.all}` },
              { key: "left", label: `已离开 ${counts.left}` },
            ]}
            value={filter}
            onChange={(k) => setFilter(k as Filter)}
          />
          <div className="spacer" />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 132 }}>
            <option value="balance">按课时从少到多</option>
            <option value="recent">按最近记录</option>
            <option value="name">按姓名</option>
          </select>
          <div className="segmented">
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")} title="表格">
              <Icon name="list" size={15} />
            </button>
            <button className={view === "card" ? "on" : ""} onClick={() => setView("card")} title="卡片">
              <Icon name="grid" size={15} />
            </button>
          </div>
        </div>
      </Card>

      {list.length === 0 ? (
        <Card>
          <Empty
            icon="users"
            title={rows.length === 0 ? "还没有学生" : "没有符合条件的学生"}
            text={rows.length === 0 ? "先把孩子建进来，之后排课、记课时都靠它" : "换个关键词或者切一下筛选"}
            action={
              rows.length === 0 ? (
                <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>
                  添加第一个学生
                </Btn>
              ) : null
            }
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <div className="table-wrap">
            <table className="table clickable">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>剩余课时</th>
                  <th>最近记录</th>
                  <th>家长</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const bal = s.balance_minutes ?? 0;
                  const low = s.status === "active" && bal < threshold;
                  const pct = Math.max(0, Math.min(100, (bal / (threshold * 3)) * 100));
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={s.name} size="sm" />
                          <div>
                            <div className="cell-main">
                              <Link href={`/students/${s.id}`}>{s.name}</Link>
                            </div>
                            <div className="cell-sub">
                              {[s.grade, s.school].filter(Boolean).join(" · ") || "未填年级"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={low ? "danger strong" : "strong"}>{toHours(bal)} 小时</div>
                        <div className="progress" style={{ width: 88, marginTop: 4 }}>
                          <i className={bal <= 0 ? "bad" : low ? "warn" : "ok"} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="muted fs-sm">{s.last_note_at ? relTime(s.last_note_at) : "还没记过"}</td>
                      <td className="fs-sm">
                        {s.guardian_name || "—"}
                        {s.guardian_phone ? <div className="cell-sub">{s.guardian_phone}</div> : null}
                      </td>
                      <td>
                        <Badge tone={s.status === "active" ? "active" : "left"}>
                          {s.status === "active" ? "在读" : "已离开"}
                        </Badge>
                      </td>
                      <td>
                        <Link href={`/students/${s.id}`} className="btn btn-sm btn-ghost">
                          详情
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid g3">
          {list.map((s) => {
            const bal = s.balance_minutes ?? 0;
            const low = s.status === "active" && bal < threshold;
            return (
              <Link key={s.id} href={`/students/${s.id}`} className="card card-pad stu-card">
                <div className="row" style={{ gap: 10 }}>
                  <span className="avatar" style={{ background: avatarColor(s.name) }}>
                    {s.name.slice(0, 1)}
                  </span>
                  <div className="grow">
                    <div className="sc-name">{s.name}</div>
                    <div className="sc-meta">{[s.grade, s.school].filter(Boolean).join(" · ") || "未填年级"}</div>
                  </div>
                  <Badge tone={s.status === "active" ? "active" : "left"}>
                    {s.status === "active" ? "在读" : "离开"}
                  </Badge>
                </div>
                <div className="row between mt-2">
                  <span className="muted fs-sm">剩余</span>
                  <span className={low ? "danger strong" : "strong"}>{toHours(bal)} 小时</span>
                </div>
                <div className="progress" style={{ marginTop: 6 }}>
                  <i
                    className={bal <= 0 ? "bad" : low ? "warn" : "ok"}
                    style={{ width: `${Math.max(0, Math.min(100, (bal / (threshold * 3)) * 100))}%` }}
                  />
                </div>
                <div className="sc-meta mt-2">{s.last_note_at ? `最近记录 ${relTime(s.last_note_at)}` : "还没记过学情"}</div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="添加学生"
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={saving} onClick={submit}>
              保存
            </Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="姓名" required>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="孩子的名字"
              autoFocus
            />
          </Field>
          <Field label="年级">
            <input
              className="input"
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              placeholder="如 三年级"
            />
          </Field>
          <Field label="性别">
            <select className="select" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </Field>
          <Field label="学校">
            <input className="input" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} />
          </Field>
          <Field label="家长姓名">
            <input
              className="input"
              value={form.guardianName}
              onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
              placeholder="如 王女士"
            />
          </Field>
          <Field label="家长电话">
            <input
              className="input"
              value={form.guardianPhone}
              onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
              placeholder="手机号"
            />
          </Field>
          <Field label="家长微信">
            <input
              className="input"
              value={form.guardianWechat}
              onChange={(e) => setForm({ ...form, guardianWechat: e.target.value })}
            />
          </Field>
          <Field label="备注" span2>
            <textarea
              className="textarea"
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="接送习惯、注意事项、性格特点…"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="批量导入学生"
        wide
        footer={
          <>
            <Btn onClick={() => setBulkOpen(false)}>取消</Btn>
            <Btn
              icon="clipboard"
              onClick={() => {
                setBulkOpen(false);
                setImportOpen(true);
              }}
            >
              从 JSON 导入
            </Btn>
            <Btn variant="primary" icon="upload" loading={bulkBusy} onClick={doImport}>
              导入 {parseBulk(bulkText).length || ""} 人
            </Btn>
          </>
        }
      >
        <Field
          label="粘贴名单"
          hint="一行一个学生：姓名 年级 家长电话 家长微信。从 Excel 复制（制表符）或用逗号、空格分隔都行；第一行表头会自动跳过。"
        >
          <textarea
            className="textarea mono"
            rows={10}
            value={bulkText}
            onChange={(e) => {
              setBulkText(e.target.value);
              setBulkErr("");
            }}
            placeholder={"张小明\t三年级\t13800000000\twxid_abc\n李小红\t四年级\t13900000000\t"}
          />
        </Field>
        {bulkErr ? (
          <div className="error-box" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
            {bulkErr}
          </div>
        ) : null}
        <p className="field-hint" style={{ marginTop: 10 }}>
          导入后是「空档案」：记得给每人记一笔课时（充值或赠送），不然下课后没课时可扣。
        </p>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scope="students"
        title="从 JSON 导入学生"
        hint="把导出的「学生名册-….json」贴进来。同名学生会跳过，不会覆盖；课时和交费不会跟着过来。"
        onDone={load}
      />
    </>
  );
}
