import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

import { LocaleProvider } from "@/components/locale-provider";
import { LocaleBootstrapScript } from "@/components/locale-bootstrap-script";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeBootstrapScript } from "@/components/theme-bootstrap-script";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Cloud Travel Guide",
  description: "智能旅行规划与导览桌面应用",
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
        <LocaleProvider>
          <ThemeProvider>
            <TooltipProvider delay={0}>
              {children}
              <Toaster position="top-center" />
            </TooltipProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
