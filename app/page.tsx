import { OracleMarquee } from "@/components/OracleMarquee";
import { SiteFooter } from "@/components/SiteFooter";
import { TopNav } from "./_landing/TopNav";
import { Hero } from "./_landing/Hero";
import { StatBand } from "./_landing/StatBand";
import { HowItWorks } from "./_landing/HowItWorks";
import { SupportedAssets } from "./_landing/SupportedAssets";
import { Integrations } from "./_landing/Integrations";
import { FinalCta } from "./_landing/FinalCta";
import { WalletRedirect } from "./_landing/WalletRedirect";

export default function Landing() {
  return (
    <div className="flex flex-col">
      <WalletRedirect />
      <TopNav />
      <OracleMarquee />
      <main id="main-content">
        <Hero />
        <StatBand />
        <HowItWorks />
        <SupportedAssets />
        <Integrations />
        <FinalCta />
      </main>
      <SiteFooter gap={false} />
    </div>
  );
}
