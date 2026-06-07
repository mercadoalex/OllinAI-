import { SiteHeader } from "./(marketing)/components/site-header";
import { Hero } from "./(marketing)/components/hero";
import { SocialProof } from "./(marketing)/components/social-proof";
import { Features } from "./(marketing)/components/features";
import { HowItWorks } from "./(marketing)/components/how-it-works";
import { Pricing } from "./(marketing)/components/pricing";
import { FinalCta } from "./(marketing)/components/final-cta";
import { SiteFooter } from "./(marketing)/components/site-footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
