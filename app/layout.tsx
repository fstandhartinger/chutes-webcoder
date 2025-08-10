import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chutes Webcoder",
  description: "Build and iterate React apps with Chutes AI-powered Webcoder.",
  icons: {
    icon: "/@favicon.png",
    shortcut: "/@favicon.png",
    apple: "/@favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Suspense fallback={<div />}>{children}</Suspense>
      </body>
    </html>
  );
}
