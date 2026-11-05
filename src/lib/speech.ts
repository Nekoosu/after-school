"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* 浏览器语音识别的最小类型（TS 标准库没带，各家是自己实现的） */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

function recognizerCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * 语音转文字：用浏览器自带的语音识别（Edge / Chrome 支持中文）。
 * 不用装 whisper，也不用把录音传到第三方；识别结果直接填进输入框，还能改。
 */
export function useSpeech(onText: (text: string) => void, lang = "zh-CN") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recRef = useRef<SRInstance | null>(null);
  const cbRef = useRef(onText);
  cbRef.current = onText;
  const finalRef = useRef("");

  useEffect(() => {
    setSupported(!!recognizerCtor());
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* 忽略 */
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* 忽略 */
    }
    setListening(false);
  }, []);

  const start = useCallback(
    (base = "") => {
      const Ctor = recognizerCtor();
      if (!Ctor) {
        setError("这个浏览器不支持语音输入，用 Edge 或 Chrome");
        return false;
      }

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = true;
      const trimmed = base.trim();
      finalRef.current = trimmed ? (trimmed.endsWith("，") || trimmed.endsWith("。") ? trimmed : trimmed + "，") : "";
      setError("");

      rec.onresult = (e: SREvent) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalRef.current += r[0].transcript;
          else interim += r[0].transcript;
        }
        cbRef.current((finalRef.current + interim).trim());
      };
      rec.onerror = (e: SRErrorEvent) => {
        setListening(false);
        setError(
          e.error === "not-allowed"
            ? "麦克风没给权限，点地址栏左边允许一下"
            : e.error === "no-speech"
              ? "没听到声音，再说一次"
              : "识别失败，试试再点一次",
        );
      };
      rec.onend = () => {
        setListening(false);
        cbRef.current(finalRef.current.trim());
      };

      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
        return true;
      } catch {
        setListening(false);
        return false;
      }
    },
    [lang],
  );

  const toggle = useCallback(
    (base = "") => {
      if (listening) stop();
      else start(base);
    },
    [listening, start, stop],
  );

  return { supported, listening, error, start, stop, toggle };
}
