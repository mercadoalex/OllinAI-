import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-b border-border py-20 lg:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(50% 80% at 50% 100%, oklch(0.62 0.18 255 / 0.2), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
          Stop guessing which deploy broke production
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Join the platform teams shipping faster with fewer incidents. Get
          started in minutes — no credit card required.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-4 text-base font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Start Free Trial
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
