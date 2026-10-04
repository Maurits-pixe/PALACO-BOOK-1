import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "PALACO BlueBook", description: "Levensader Vertical Slice" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="nl"><body><header><strong>PALACO BlueBook</strong><span>v0.1-alpha · Levensader</span></header>{children}</body></html>;
}
