import { getTranslations } from "next-intl/server";
import { getBrandingSettings } from "@/lib/admin/get-branding-settings";
import { BrandingStudio } from "@/components/branding/branding-studio";
import { LoadFailed } from "@/components/data-table/load-failed";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("branding");
  return { title: t("title") };
}

export default async function AdminBrandingPage() {
  const [t, { data, failed, status, failure, message, debug }] = await Promise.all([
    getTranslations("branding"),
    getBrandingSettings(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {failed ? (
        <LoadFailed
          description={t("loadFailed")}
          status={status}
          failure={failure}
          message={message}
          debug={debug}
        />
      ) : (
        <BrandingStudio mode="admin" initialBranding={data?.branding} />
      )}
    </div>
  );
}
