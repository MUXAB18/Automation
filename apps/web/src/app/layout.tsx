import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "SEO & Social Automation",
  description: "Internal SEO and social media automation platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
