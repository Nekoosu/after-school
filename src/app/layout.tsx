import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "课后服务管理",
  description: "一个老师、几十个学生的课后服务管理：排课、课时、学情、家长反馈",
  applicationName: "课后服务",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "课后服务",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563eb",
};

const themeBoot = `try{var t=localStorage.getItem("as-theme");if(t!=="light"&&t!=="dark"){t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
