import { converter } from "culori";

export const DEFAULT_BRANDING = {
  name: "Control Panel",
  logo: "/brand/panel-horizontal-light.svg",
  logo_dark: "/brand/panel-horizontal-dark.svg",
  icon: "/brand/panel-mark-light.svg",
  icon_dark: "/brand/panel-mark-dark.svg",
  favicon: "/brand/panel-favicon.svg",
  primary_color: "#3B82F6",
};

export const BRANDING_ASSET_FIELDS = [
  "logo",
  "logo_dark",
  "icon",
  "icon_dark",
  "favicon",
];

const toOklch = converter("oklch");

// Only http(s) URLs or paths starting with "/" (blocks data:, javascript: and //host).
export function usableAsset(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/")) return true;

  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function usableColor(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return Boolean(trimmed) && Boolean(toOklch(trimmed));
}

export function mergeBranding(branding) {
  const merged = { ...DEFAULT_BRANDING };
  if (!branding || typeof branding !== "object") return merged;

  if (typeof branding.name === "string" && branding.name.trim()) {
    merged.name = branding.name.trim();
  }

  if (usableColor(branding.primary_color)) {
    merged.primary_color = branding.primary_color.trim();
  }

  for (const field of BRANDING_ASSET_FIELDS) {
    if (usableAsset(branding[field])) merged[field] = branding[field].trim();
  }

  return merged;
}
