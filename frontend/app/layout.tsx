import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知录｜本地 Markdown 媒体知识工作台",
  description:
    "从视频与播客取得文本，整理成摘要、导图与摘录，并沉淀为本地可编辑的 Markdown 知识稿。",
  icons: {
    icon: "/favicon.svg"
  }
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
