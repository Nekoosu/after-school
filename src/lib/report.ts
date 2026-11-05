import { LEVEL_CN, mdText, NOTE_KIND_CN } from "./format.ts";

/**
 * 家长反馈草稿生成器（纯函数，本地规则，不联网）
 * 定位：把你这段时间记的零碎学情，组织成一段能直接发给家长的话。
 * 它只做「表达」，判断仍然是你自己的——生成后一定自己读一遍再发。
 */

export interface ReportLesson {
  start_at: string;
  status: string;
  att_status: string | null;
}

export interface ReportNote {
  created_at: string;
  kind: string;
  topic: string | null;
  level: number | null;
  content: string;
}

export interface ReportInput {
  studentName: string;
  orgName: string;
  teacherName: string;
  periodStart: string;
  periodEnd: string;
  lessons: ReportLesson[];
  notes: ReportNote[];
  usedMinutes: number;
  balanceMinutes: number;
  lessonMinutes: number;
  /** 反馈语气：plain 常规 / warm 亲切 / brief 简短（设置页可选） */
  tone?: FeedbackTone;
}

export type FeedbackTone = "plain" | "warm" | "brief";

const KIND_ORDER = ["progress", "homework", "behavior", "parent"];

function attLine(att: Record<string, number>): string {
  const parts: string[] = [];
  if (att.present) parts.push(`出勤 ${att.present} 次`);
  if (att.makeup) parts.push(`补课 ${att.makeup} 次`);
  if (att.leave) parts.push(`请假 ${att.leave} 次`);
  if (att.absent) parts.push(`缺席 ${att.absent} 次`);
  return parts.length ? parts.join("，") : "这段时间没有上课记录";
}

export function buildReport(i: ReportInput): string {
  const tone: FeedbackTone = i.tone ?? "plain";
  const brief = tone === "brief";
  const done = i.lessons.filter((l) => l.status === "done");
  const att: Record<string, number> = { present: 0, leave: 0, absent: 0, makeup: 0 };
  for (const l of done) if (l.att_status && att[l.att_status] !== undefined) att[l.att_status] += 1;

  const out: string[] = [];
  out.push(brief ? `${i.studentName} 家长：` : `${i.studentName} 家长您好：`);
  out.push("");
  if (brief) {
    out.push(`${mdText(i.periodStart)} 到 ${mdText(i.periodEnd)} 课后情况：`);
  } else if (tone === "warm") {
    out.push(
      `${mdText(i.periodStart)} 到 ${mdText(i.periodEnd)} 这段时间的课后情况，跟您同步一下。孩子最近挺用心，下面是细节：`,
    );
  } else {
    out.push(`${mdText(i.periodStart)} 到 ${mdText(i.periodEnd)} 这段时间的课后情况，跟您同步一下。`);
  }
  out.push("");
  out.push("【出勤】");
  out.push(
    done.length
      ? `期间共上 ${done.length} 次课，${attLine(att)}。`
      : "这段时间还没有已完成的课次。",
  );

  const usedH = (i.usedMinutes / 60).toFixed(1).replace(/\.0$/, "");
  const balH = (i.balanceMinutes / 60).toFixed(1).replace(/\.0$/, "");
  const leftTimes = i.lessonMinutes > 0 ? Math.floor(i.balanceMinutes / i.lessonMinutes) : 0;
  out.push("");
  out.push("【课时】");
  out.push(`本期消耗 ${usedH} 小时，目前剩余 ${balH} 小时（约 ${leftTimes} 次课）。`);
  if (i.balanceMinutes <= 0) out.push("课时已经用完啦，下次上课前麻烦续一下。");
  else if (leftTimes <= 2) out.push("课时不多了，方便的时候续一下，别耽误孩子上课。");

  const good = i.notes.filter((n) => (n.level ?? 3) >= 3);
  const weak = i.notes.filter((n) => (n.level ?? 3) <= 2);

  const byKind = (list: ReportNote[]) => {
    const rows: string[] = [];
    for (const k of KIND_ORDER) {
      const group = list.filter((n) => n.kind === k);
      if (!group.length) continue;
      rows.push(`${NOTE_KIND_CN[k] ?? k}：`);
      for (const n of group) {
        const tag = n.topic ? `${n.topic}——` : "";
        rows.push(`· ${mdText(n.created_at.slice(0, 10))} ${tag}${n.content}`);
      }
    }
    return rows;
  };

  if (good.length) {
    out.push("");
    out.push("【这段时间的表现】");
    out.push(...byKind(good));
  }
  if (weak.length) {
    out.push("");
    out.push("【需要一起盯一下的地方】");
    out.push(...byKind(weak));
  }
  if (!i.notes.length) {
    out.push("");
    out.push("【这段时间的表现】");
    out.push("这段时间的记录还不多，下次我多留意，攒一些再跟您细说。");
  }

  // 建议：从记录里提炼，不凭空编
  const tips: string[] = [];
  if (weak.length && weak.length >= good.length) tips.push("薄弱的地方这几周多练两遍，我下次课会再带着过一遍。");
  if (good.length && !weak.length) tips.push("状态不错，保持现在的节奏就行。");
  if (att.leave) tips.push("落下的内容我会找时间补上，不用担心进度。");
  if (att.absent) tips.push("缺席的那次内容有点衔接不上，建议安排一次补课。");
  if (i.balanceMinutes > 0 && leftTimes > 2) tips.push("课时还够，按现在的节奏上就好。");
  if (!tips.length) tips.push("有问题随时跟我说，我们一起看怎么调整。");

  out.push("");
  out.push("【下一步】");
  if (brief) out.push(`· ${tips[0]}`);
  else for (const t of tips) out.push(`· ${t}`);
  out.push("");
  if (tone === "warm") out.push("孩子在进步，咱们保持联系。谢谢您。");
  else if (brief) out.push("有需要随时联系我。");
  else out.push("有什么想法随时联系我，谢谢您。");
  out.push("");
  out.push(`${i.orgName}　${i.teacherName || "老师"}`);

  return out.join("\n");
}

/** 一条学情记录在列表里的一行字 */
export function noteLine(n: ReportNote): string {
  const lv = n.level ? `（${LEVEL_CN[n.level] ?? n.level}）` : "";
  return `${mdText(n.created_at.slice(0, 10))} ${NOTE_KIND_CN[n.kind] ?? n.kind}${lv}：${n.content}`;
}

export interface LessonReportInput {
  studentName: string;
  orgName: string;
  teacherName: string;
  /** 这节课的日期 YYYY-MM-DD */
  dateStr: string;
  courseName: string;
  lessonTitle: string | null;
  planTitle: string | null;
  /** 从教案里挑出来的要点（planPoints），没有就空数组 */
  planPoints: string[];
  /** present / leave / absent / makeup / null */
  attStatus: string | null;
  /** 老师自己写的那一句（可为空） */
  brief: string;
  billedMinutes: number;
  balanceMinutes: number;
  lessonMinutes: number;
  topic?: string | null;
  level?: number | null;
  tone?: FeedbackTone;
}

/**
 * 单节课的家长反馈草稿。
 * 和周期版（buildReport）的区别：上课内容直接来自教案，不用老师再说一遍；
 * 老师只需要补一句「今天他怎么样」。
 */
export function buildLessonReport(i: LessonReportInput): string {
  const out: string[] = [];
  const brief = (i.brief ?? "").trim();
  const tone: FeedbackTone = i.tone ?? "plain";
  const times = i.lessonMinutes > 0 ? Math.floor(i.balanceMinutes / i.lessonMinutes) : 0;

  out.push(tone === "brief" ? `${i.studentName} 家长：` : `${i.studentName} 家长您好：`);
  out.push("");

  // 今天讲了什么 —— 来自备课，老师不用重复
  const content =
    i.planPoints.length > 0
      ? `「${i.planTitle || i.lessonTitle || i.courseName}」——${i.planPoints.join("、")}`
      : i.lessonTitle || i.courseName;
  const dayWord = `${mdText(i.dateStr)} 这节课`;
  out.push(`${dayWord}我们讲的是${content}。`);

  // 今天怎么样
  if (i.attStatus === "leave") {
    out.push("");
    out.push(`孩子今天请假了，这节课的内容我先记下来，回头找时间给他补上。`);
  } else if (i.attStatus === "absent") {
    out.push("");
    out.push(`今天孩子没来上课，讲的内容我先留着，方便的时候安排一次补课补上。`);
  } else if (brief) {
    out.push("");
    const head = i.attStatus === "makeup" ? "今天补的是之前落下的内容，" : "";
    out.push(`${head}${brief}`);
  }

  if (i.topic) {
    const lv = i.level ? `，我按「${LEVEL_CN[i.level] ?? i.level}」记的` : "";
    out.push(`今天重点练的是「${i.topic}」${lv}。`);
  }

  // 课时
  const usedH = (i.billedMinutes / 60).toFixed(1).replace(/\.0$/, "");
  const balH = (i.balanceMinutes / 60).toFixed(1).replace(/\.0$/, "");
  out.push("");
  if (i.billedMinutes > 0) {
    out.push(`【课时】这次扣 ${usedH} 小时，目前还剩 ${balH} 小时${times > 0 ? `（约 ${times} 次课）` : ""}。`);
  } else {
    out.push(`【课时】这次没有扣课时，目前还剩 ${balH} 小时${times > 0 ? `（约 ${times} 次课）` : ""}。`);
  }
  if (i.balanceMinutes <= 0) out.push("课时已经用完啦，下次上课前麻烦续一下。");
  else if (times <= 2) out.push("课时不多了，方便的时候续一下，别耽误孩子上课。");

  // 下一步
  const tips: string[] = [];
  if (i.attStatus === "leave" || i.attStatus === "absent") tips.push("补课时间我排好之后跟您说。");
  if (i.topic && (i.level ?? 3) <= 2) tips.push(`「${i.topic}」这块下次课我再带着过一遍。`);
  if (i.topic && (i.level ?? 3) >= 3) tips.push(`「${i.topic}」这块掌握得不错，下次会往上加一点难度。`);
  if (!tips.length && brief) tips.push("下次课我会接着这个进度往后讲。");
  if (tips.length) {
    out.push("");
    out.push("【下一步】");
    for (const t of tips) out.push(`· ${t}`);
  }

  out.push("");
  if (tone === "warm") out.push("这节课孩子状态不错，辛苦您在家也多鼓励。谢谢您。");
  else if (tone === "brief") out.push("有需要随时联系我。");
  else out.push("有想问的随时跟我说，谢谢您。");
  out.push("");
  out.push(`${i.orgName}　${i.teacherName || "老师"}`);
  return out.join("\n");
}
