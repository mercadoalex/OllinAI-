import type { Metadata } from "next";
import { DocsClient } from "./components/docs-client";

export const metadata: Metadata = {
  title: "Documentation — OllinAI",
  description:
    "Guides, concepts, and API reference for OllinAI — the deployment risk and change intelligence platform. Learn DORA metrics, risk scoring, integrations, and webhooks.",
};

export default function DocsPage() {
  return <DocsClient />;
}
