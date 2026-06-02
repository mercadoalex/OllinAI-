import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OllinAI — Change Intelligence & Deployment Risk",
  description:
    "Reduce change failure rates, track DORA metrics, and understand the risk profile of every deployment.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
