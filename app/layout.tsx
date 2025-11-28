import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import ConsoleCapture from "./components/ConsoleCapture";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });

export const metadata: Metadata = {
  title: "Chutes Webcoder",
  description: "Build and iterate React apps with Chutes AI-powered Webcoder.",
  icons: {
    icon: [
      { url: "/favicon-32x32.png?v=2", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png?v=2", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon-32x32.png?v=2",
    apple: "/favicon-32x32.png?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${grotesk.variable}`}>
      <body className={`${grotesk.className} antialiased bg-surface-ink-950 text-ink-50`}>
        <ConsoleCapture />
        <Suspense fallback={<div />}>{children}</Suspense>
      </body>
    </html>
  );
}
