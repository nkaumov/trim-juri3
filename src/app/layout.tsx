import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jurist3 Workspace",
  description: "AI-ассистент для согласования договоров",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
