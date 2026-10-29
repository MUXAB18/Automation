import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata = {
  title: { default: "SEO & Social Automation", template: "%s · SEO & Social Automation" },
  description: "Internal SEO and social media automation platform",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // "system" leaves data-theme unset so the OS preference applies.
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>
        {children}
        <Toaster theme={theme} richColors closeButton position="bottom-right" />
      </body>
    </html>
  );
}
