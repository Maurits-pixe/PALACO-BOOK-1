import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PALACO · De Levensader",
  description: "Evidence-aware kennis- en mentorwerkruimte van PALACO.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="nl"><body>{children}</body></html>;
}
