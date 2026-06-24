import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

import { AuthBootstrap } from "@/components/auth/auth-bootstrap";
import { LocaleBootstrapScript } from "@/components/locale-bootstrap-script";
import { ThemeBootstrapScript } from "@/components/theme-bootstrap-script";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="h-screen overflow-hidden bg-surface-950 text-ink-100 antialiased">
        <ThemeBootstrapScript />
        <LocaleBootstrapScript />
        <AuthBootstrap />
        <TooltipProvider delay={0}>
          {children}
          <Toaster position="top-center" />
        </TooltipProvider>
      </body>
    </html>
  );
}
