import { setting } from "@/db";
import type { FeedbackTone } from "@/lib/report";

/** 设置页选的反馈语气；库里是脏值就退回「常规」，不猜。 */
export function feedbackTone(): FeedbackTone {
  const v = setting("feedback_tone", "plain");
  return v === "warm" || v === "brief" ? v : "plain";
}
