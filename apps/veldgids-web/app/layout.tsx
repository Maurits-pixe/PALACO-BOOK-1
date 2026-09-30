import "./globals.css";
import type { ReactNode } from "react";
export const metadata={title:"De Mentale Veldgids",description:"PALACO evidence-aware mentor workspace"};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="nl"><body>{children}</body></html>}
