"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Palette } from "lucide-react";
import Link from "@/components/ui/app-link";
import { Logo } from "@/components/logo";
import { RegisterForm } from "@/components/forms/register-form";
import { BrandingStudio } from "@/components/branding/branding-studio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function FirstRunWizard({ initialBranding, policy }) {
  const [step, setStep] = useState("register");
  const t = useTranslations("branding");
  const tAuth = useTranslations("auth");

  function switchStep(nextStep) {
    setStep(nextStep);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (step === "branding") {
    return (
      <div data-auth-wide="true" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-e1">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{t("setupStepBadge")}</Badge>
              <span className="text-base font-semibold tracking-tight">{t("setupTitle")}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t("setupSubtitle")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => switchStep("register")}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("setupBackToRegister")}
          </Button>
        </div>

        <BrandingStudio
          mode="setup"
          initialBranding={initialBranding}
          onSuccess={() => switchStep("register")}
          onSkip={() => switchStep("register")}
        />
      </div>
    );
  }

  return (
    <Card className="w-full gap-0 shadow-xl shadow-black/5">
      <CardHeader className="flex flex-col items-center gap-2 pb-6 text-center">
        <Logo className="mb-2 h-9 w-auto" />
        <CardTitle className="text-xl">{tAuth("registerTitle")}</CardTitle>
        <CardDescription>{tAuth("registerSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 pt-6">
        <div className="flex flex-col gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Palette className="size-4 shrink-0 text-primary" aria-hidden />
              <span>{t("setupTitle")}</span>
            </div>
            <Badge variant="default">{t("setupStepBadge")}</Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("setupSubtitle")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => switchStep("branding")}
            className="w-full justify-between bg-background"
          >
            <span>{t("setupCustomizeButton")}</span>
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>

        <RegisterForm policy={policy} />

        <p className="text-center text-sm text-muted-foreground">
          {tAuth("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {tAuth("loginLink")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
