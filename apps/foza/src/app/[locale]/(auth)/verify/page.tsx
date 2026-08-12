import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { VerifyCard } from "@/components/site/verify-card";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <VerifyCard />
    </Suspense>
  );
}
