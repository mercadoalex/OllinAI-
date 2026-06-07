import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header with logo */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/ollin_logo_white.png"
              alt="OllinAI"
              width={120}
              height={32}
              priority
            />
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-16 px-6 text-center max-w-4xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight">
          Know if your next deploy will break production — before you ship
        </h1>
        <p className="mt-6 text-lg text-gray-600 max-w-2xl mx-auto">
          OllinAI correlates deployments with incidents, scores risk with ML, and gives your team actionable DORA metrics across every service.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="px-6 py-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
          >
            Start Free Trial
          </Link>
          <Link
            href="#features"
            className="px-6 py-3 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            See How It Works
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-12">
            Everything you need to reduce deployment risk
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: "Predictive Risk Scoring", desc: "Score every deployment before it ships. Block high-risk changes automatically." },
              { title: "Incident Correlation", desc: "Automatically link production incidents to the deployment that caused them." },
              { title: "DORA Metrics by Team", desc: "Track Deployment Frequency, Lead Time, Change Failure Rate, and MTTR per team." },
              { title: "ML-Powered Predictions", desc: "Trained on your deployment history to predict failures before they happen." },
              { title: "Supply Chain Security", desc: "eBPF agent detects credential exfiltration and anomalous behavior during builds." },
              { title: "Automated Remediation", desc: "Auto-rollback, halt canary, or scale up when prediction confidence is high." },
            ].map((feature) => (
              <div key={feature.title} className="p-6 bg-white rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-gray-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Image
            src="/ollin_logo_white.png"
            alt="OllinAI"
            width={80}
            height={22}
          />
          <p className="text-xs text-gray-500">© 2024 OllinAI. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
