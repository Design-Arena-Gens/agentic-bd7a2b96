import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Lipsync + Body Motion",
  description: "Web-based lipsync AI with body motion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
