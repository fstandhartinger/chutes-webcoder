import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import ConsoleCapture from "./components/ConsoleCapture";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "sonner";

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
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-neutral-950 text-white">
        <AuthProvider>
          <ConsoleCapture />
          {/* Header is now rendered inside pages to allow different headers per page */}
          <Suspense fallback={<div />}>{children}</Suspense>
          <Toaster 
            position="bottom-right"
            toastOptions={{
              className: 'bg-neutral-900 text-white border border-neutral-700 rounded-xl',
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
