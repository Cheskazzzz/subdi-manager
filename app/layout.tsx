import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Isabel Village Management System",
  description: "A simple subdivision management system",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
