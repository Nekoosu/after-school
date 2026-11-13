"use client";

import { useEffect, useState } from "react";
import { Btn, Modal, useToast } from "./ui";
import { Icon } from "./icons";
import { copyText, post } from "@/lib/client";
import { cn } from "@/lib/format";

export interface LicState {
  mode: "licensed" | "trial" | "locked";
  daysLeft: number | null;
  machine?: string;
  exp?: string | null;
  seats?: number | null;
}

/** 作者的收码邮箱：界面上直接露出来，省得用户再问「发给谁」。 */
const AUTHOR_MAIL = "nekoosu2021@outlook.com";

/**
 * 激活窗：试用条右边的「填激活码」直接打开，不必等到期才填。
 * 流程：看清机器码 → 发到作者邮箱 → 粘回激活码 → 点「激活」，验签与写文件都在本机，全程不联网。
 */
export function LicenseDialog({
  open,
  onClose,
  onLicensed,
}: {
  open: boolean;
  onClose: () => void;
  onLicensed?: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<LicState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedMail, setCopiedMail] = useState(false);

  // 每次打开都重新问一遍：可能刚在桌面壳的激活窗里激活过
  useEffect(() => {
    if (!open) return;
    setErr("");
    setCopied(false);
    setCopiedMail(false);
    let dead = false;
    fetch("/api/license", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!dead) setState(d as LicState);
      })
      .catch(() => {
        /* 拿不到就当没状态，下面会显示「拿不到机器码」那条 */
      });
    return () => {
      dead = true;
    };
  }, [open]);

  async function submit() {
    const cdk = code.trim();
    if (!cdk) {
      setErr("先把作者给你的激活码粘进上面的框。");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await post<{ ok: boolean; state?: LicState; error?: string }>("/api/license", { cdk });
      if (r?.ok && r.state) {
        setState(r.state);
        setCode("");
        toast.ok("这台电脑已激活，功能不受限了。");
        onClose();
        onLicensed?.();
      } else {
        setErr(r?.error || "激活码没验过：格式、签名或机器码对不上。");
      }
    } catch {
      setErr("本地服务没应答：确认是桌面程序在跑，再试一次。");
    } finally {
      setBusy(false);
    }
  }

  const machine = String(state?.machine || "");
  // 一次复制走完「机器码 + 第二台的占位 + 发给谁」：用户直接粘到微信 / 邮件里发出去就行
  const mailBody = [
    "课后服务管理 · 申请激活码",
    "机器码：" + (machine ? machine.toUpperCase() : "（这台电脑没读到机器码）"),
    "第二台电脑的机器码：（只有一台就留空）",
    "发给：" + AUTHOR_MAIL,
  ].join("\n");

  async function copyMailBody() {
    try {
      await copyText(mailBody);
      toast.ok("已复制，粘到微信或邮件里发给 " + AUTHOR_MAIL + " 就行");
      setCopied(true);
    } catch (e) {
      toast.bad(String((e as Error)?.message || e));
    }
  }

  async function copyMailAddr() {
    try {
      await copyText(AUTHOR_MAIL);
      toast.ok("邮箱已复制：" + AUTHOR_MAIL);
      setCopiedMail(true);
    } catch (e) {
      toast.bad(String((e as Error)?.message || e));
    }
  }
  const head =
    state?.mode === "licensed"
      ? {
          bad: false,
          text: state?.seats
            ? `这台电脑已激活。这张码一共授权 ${state.seats} 台电脑。`
            : "这台电脑已激活，功能不受限。",
        }
      : state?.mode === "locked"
        ? { bad: true, text: "试用已经结束，填一张激活码就能继续用，已经记的数据都还在。" }
        : {
            bad: false,
            text: `试用版：还剩 ${state?.daysLeft ?? 0} 天。到期前随便哪天填都行，现在功能不受限。`,
          };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="激活这台电脑"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            以后再说
          </Btn>
          <Btn variant="primary" icon="key" loading={busy} onClick={submit}>
            激活
          </Btn>
        </>
      }
    >
      <div className="license-dlg">
        <div className={cn("license-dlg-state", head.bad && "bad")}>
          <Icon name={head.bad ? "alert" : "info"} size={15} strokeWidth={2.2} />
          <span>{head.text}</span>
        </div>

        <div className="license-dlg-block">
          <div className="license-dlg-label">第一步 · 把机器码发给作者</div>
          {machine ? (
            <div className="license-dlg-machine">
              <code>{machine.toUpperCase()}</code>
              <Btn size="sm" icon={copied ? "check" : "copy"} onClick={copyMailBody}>
                {copied ? "已复制" : "复制申请内容"}
              </Btn>
            </div>
          ) : (
            <div className="license-dlg-machine">
              <span className="muted">这台电脑拿不到机器码：请用桌面程序打开，别用浏览器直连。</span>
            </div>
          )}
          <div className="license-dlg-mail">
            作者邮箱：
            <button type="button" className="license-dlg-mailbtn" onClick={copyMailAddr} title="点一下复制邮箱地址">
              {AUTHOR_MAIL}
              <Icon name={copiedMail ? "check" : "copy"} size={12} strokeWidth={2.2} />
            </button>
            <span className="muted">　点邮箱复制地址，粘到收件人里就行</span>
          </div>
          <div className="license-dlg-note">一个激活码最多绑两台电脑；激活以后不用联网，也不上报任何东西。</div>
        </div>

        <div className="license-dlg-block">
          <div className="license-dlg-label">第二步 · 粘贴作者给你的激活码</div>
          <textarea
            className="textarea license-dlg-code"
            rows={3}
            value={code}
            spellCheck={false}
            autoComplete="off"
            placeholder="AS1.……"
            onChange={(e) => {
              setCode(e.target.value);
              if (err) setErr("");
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                if (!busy) void submit();
              }
            }}
            disabled={busy}
          />
          <div className="license-dlg-note">以 AS1. 开头的一整串，直接粘贴；别删里面的点，也别加空格或换行。</div>
        </div>

        {err ? (
          <div className="license-dlg-err">
            <Icon name="alert" size={15} strokeWidth={2.2} />
            <span>{err}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
