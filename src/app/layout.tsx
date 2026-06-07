import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "OllinAI — Change Intelligence & Deployment Risk",
  description:
    "OllinAI correlates deployments with incidents, scores risk with ML, and gives your team actionable DORA metrics across every service. Know if your next deploy will break production before you ship.",
  keywords: [
    "deployment risk",
    "DORA metrics",
    "change intelligence",
    "incident correlation",
    "CI/CD",
    "DevOps",
    "MTTR",
    "change failure rate",
  ],
  openGraph: {
    title: "OllinAI — Change Intelligence & Deployment Risk",
    description:
      "Score risk with ML, correlate incidents with deployments, and track DORA metrics across every service.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} bg-background antialiased`}
    >
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
