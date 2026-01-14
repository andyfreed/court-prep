import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Court Prep",
  description: "Custody Case Assistant workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <div className="min-h-screen">
          <header className="border-b">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <div className="text-lg font-semibold">Court Prep</div>
              <nav className="flex gap-4 text-sm text-muted-foreground">
                <a href="/chat" className="hover:text-foreground">
                  Chat
                </a>
                <a href="/documents" className="hover:text-foreground">
                  Documents
                </a>
                <a href="/timeline" className="hover:text-foreground">
                  Timeline
                </a>
                <a href="/lawyer-notes" className="hover:text-foreground">
                  Lawyer Notes
                </a>
                <a href="/insights" className="hover:text-foreground">
                  Insights
                </a>
                <a href="/settings" className="hover:text-foreground">
                  Settings
                </a>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
