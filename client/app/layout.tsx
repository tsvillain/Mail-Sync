import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mail Sync",
  description: "Multi-account Gmail sync dashboard and email viewer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
