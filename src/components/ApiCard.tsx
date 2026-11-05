"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Btn, Card, CardHead, useToast } from "@/components/ui";
import { api, post } from "@/lib/client";

interface TokenState {
  has: boolean;
  token: string;
}

/**
 * 「对接与接口」卡：生成令牌 + 演示地址。
 * 令牌只在设置页可见；接口文档在 /docs，不在这里堆。
 */
export function ApiCard() {
  const toast = useToast();
  const [st, setSt] = useState<TokenState | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    api<TokenState>("/api/token")
      .then(setSt)
      .catch((e: Error) => toast.bad(e.message));
  }, [toast]);

  async function create() {
    setBusy(true);
    try {
      setSt(await post<TokenState>("/api/token", { action: "new" }));
      toast.ok("令牌已生成，旧令牌立刻失效");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      setSt(await post<TokenState>("/api/token", { action: "clear" }));
      toast.ok("已关闭对接，外部程序现在进不来");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!st?.token) return;
    try {
      await navigator.clipboard.writeText(st.token);
      toast.ok("令牌已复制");
    } catch {
      toast.bad("这个浏览器不让自动复制，请手动选中复制");
    }
  }

  const sample = `curl -H "Authorization: Bearer ${st?.token || "<令牌>"}" ${origin || "http://127.0.0.1:3002"}/api/v1/summary`;

  return (
    <Card>
      <CardHead
        title="对接与接口"
        icon="zap"
        sub="给别的程序或 AI 助手读数据用，不开也不影响正常使用"
        actions={
          <a className="btn btn-sm" href="/docs" target="_blank" rel="noreferrer">
            <Icon name="file" size={15} />
            接口说明
          </a>
        }
      />
      <div className="card-body">
        <div className="row between" style={{ gap: 12, marginBottom: 10 }}>
          <span className="muted">状态</span>
          {st?.has ? (
            <Badge tone="ok">已开启</Badge>
          ) : (
            <Badge tone="warn">未开启</Badge>
          )}
        </div>

        {st?.has ? (
          <>
            <div className="api-token" style={{ marginBottom: 10 }}>
              <span className="v">{st.token}</span>
              <Btn size="sm" icon="copy" onClick={copy}>
                复制
              </Btn>
            </div>
            <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
              <Btn size="sm" icon="refresh" loading={busy} onClick={create}>
                换个新令牌
              </Btn>
              <Btn size="sm" icon="x" loading={busy} onClick={clear}>
                关闭对接
              </Btn>
            </div>
          </>
        ) : (
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <Btn size="sm" variant="primary" icon="sparkles" loading={busy} onClick={create}>
              生成令牌
            </Btn>
            <span className="muted fs-xs">生成后，外部程序带上它就能读 /api/v1 下的接口</span>
          </div>
        )}

        <div className="api-code" style={{ marginBottom: 6 }}>
          {sample}
        </div>
        <p className="muted fs-xs" style={{ margin: 0 }}>
          给 AI 助手、机器人、Excel 插件用都可以；令牌等于密码，别贴到群里。想收回就点「关闭对接」。
        </p>
      </div>
    </Card>
  );
}
