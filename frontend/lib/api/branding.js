import { api } from "@/lib/api/client";

export function setupFirstRunBranding(formData) {
  return api.post("/branding/setup", formData);
}

export function getAdminBranding({ signal } = {}) {
  return api.get("/admin/branding", { signal });
}

export function updateAdminBranding(formData) {
  return api.post("/admin/branding", formData);
}

export function resetAdminBranding() {
  return api.delete("/admin/branding");
}
