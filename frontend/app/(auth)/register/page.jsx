import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getBasicInfo } from "@/lib/basic-info/get-basic-info";
import { getBranding } from "@/lib/branding/get-branding";
import { PanelUnavailableCard } from "@/components/sections/panel-unavailable";
import { isPanelUnavailable } from "@/lib/api/unavailable";
import { RateLimitedCard } from "@/components/sections/rate-limited";
import { isRateLimited } from "@/lib/api/rate-limited";
import { RequestFailedCard } from "@/components/sections/request-failed";
import { isRequestFailed, requestFailureProps } from "@/lib/api/request-failed";
import { FirstRunWizard } from "@/components/auth/first-run-wizard";

export default async function RegisterPage() {
  let user, basicInfo, branding;
  try {
    [user, basicInfo, branding] = await Promise.all([
      getCurrentUser(),
      getBasicInfo(),
      getBranding(),
    ]);
  } catch (error) {
    if (isRateLimited(error)) return <RateLimitedCard />;
    if (isPanelUnavailable(error)) return <PanelUnavailableCard />;
    if (isRequestFailed(error)) return <RequestFailedCard {...requestFailureProps(error)} />;
    throw error;
  }

  if (user) redirect("/");
  if (!basicInfo.registration_open) redirect("/login");

  return (
    <FirstRunWizard
      initialBranding={branding}
      policy={basicInfo.password_policy}
    />
  );
}
