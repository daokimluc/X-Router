import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/components/home/hero";
import { Features } from "@/components/home/features";
import { ModelsTable } from "@/components/home/models-table";
import { Integrations } from "@/components/home/integrations";
import { HowItWorks, Providers, FinalCta } from "@/components/home/sections";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Hero />
      <Features />
      <ModelsTable />
      <Integrations />
      <HowItWorks />
      <Providers />
      <FinalCta />
    </>
  );
}
