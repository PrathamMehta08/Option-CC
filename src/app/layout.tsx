import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Matches prathamm.com: Inter for the UI, IBM Plex Mono for figures.
 *
 * Loaded through next/font, which self-hosts the files and preloads them —
 * the Google Fonts @import this replaced blocked first paint.
 */
const sans = Inter({
  variable: "--font-sans-custom",
  subsets: ["latin"],
  display: "swap",
});

/**
 * IBM Plex Mono is not a variable font, so the weights are listed explicitly.
 * Its tabular figures keep the option table's columns from shifting as values
 * change.
 */
const mono = IBM_Plex_Mono({
  variable: "--font-mono-custom",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Option Income Screener",
  description:
    "Screen covered calls and cash-secured puts over live option chains, ranked by annualized return.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables go on <html>, not <body>: Tailwind resolves its theme
    // variables at :root, so a variable defined only on <body> is undefined
    // where `font-sans` is generated and the whole declaration is dropped.
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
