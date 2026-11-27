import { read } from "@/lib/api/read";
import { adminBrandingResponseSchema } from "@/lib/schemas/branding";

export function getBrandingSettings() {
  return read("/admin/branding", adminBrandingResponseSchema);
}
