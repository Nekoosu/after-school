"use client";

import { useEffect } from "react";
import { Icon } from "./icons";
import { cn } from "@/lib/format";
import { useSpeech } from "@/lib/speech";
import { useToast } from "./ui";

/** 语音输入按钮：点一下开始说，说完自动填进旁边的输入框 */
export function MicButton({
  onText,
  base,
  size = 15,
  className,
}: {
  onText: (text: string) => void;
  base?: string;
  size?: number;
  className?: string;
}) {
  const toast = useToast();
  const { supported, listening, error, toggle } = useSpeech(onText);

  useEffect(() => {
    if (error) toast.bad(error);
  }, [error, toast]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className={cn("btn btn-icon btn-sm mic-btn", listening && "mic-on", className)}
      onClick={() => toggle(base ?? "")}
      title={listening ? "正在听…点一下结束" : "语音输入"}
      aria-label="语音输入"
    >
      <Icon name="mic" size={size} />
    </button>
  );
}
