import { OracleMarquee } from "@/components/OracleMarquee";
import { SiteFooter } from "@/components/SiteFooter";
import { TopNav } from "./_landing/TopNav";
import { Hero } from "./_landing/Hero";
import { StatBand } from "./_landing/StatBand";
import { RateComparison } from "./_landing/RateComparison";
import { HowItWorks } from "./_landing/HowItWorks";
import { SupportedAssets } from "./_landing/SupportedAssets";
import { Integrations } from "./_landing/Integrations";
import { FinalCta } from "./_landing/FinalCta";
import { WalletRedirect } from "./_landing/WalletRedirect";
import { Reveal } from "./_landing/Reveal";

export default function Landing() {
  return (
    <div className="flex flex-col">
      <WalletRedirect />
      <TopNav />
      <OracleMarquee />
      <main id="main-content">
        <Hero />
        <StatBand />
        <Reveal>
          <RateComparison />
        </Reveal>
        <Reveal>
          <HowItWorks />
        </Reveal>
        <Reveal>
          <SupportedAssets />
        </Reveal>
        <Reveal>
          <Integrations />
        </Reveal>
        <Reveal>
          <FinalCta />
        </Reveal>
      </main>
      <SiteFooter gap={false} />
    </div>
  );
}
