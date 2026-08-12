import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/site/auth-card";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <AuthCard mode="login" />
    </Suspense>
  );
}
