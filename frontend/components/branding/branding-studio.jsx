"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Image as ImageIcon,
  Loader2,
  Palette,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  resetAdminBranding,
  setupFirstRunBranding,
  updateAdminBranding,
} from "@/lib/api/branding";
import { apiMessage } from "@/lib/api/error-message";
import { DEFAULT_BRANDING } from "@/lib/branding/merge-branding";
import { revalidateBranding } from "@/lib/branding/revalidate";
import { generatePalette } from "@/lib/theme/generate-palette";
import { useBranding } from "@/hooks/use-branding";
import { useRefresh } from "@/hooks/use-refresh";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardSaveFooter } from "@/components/ui/card-save-footer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Note } from "@/components/ui/note";
import { ReasonTooltip } from "@/components/ui/reason-tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWatchUnsaved } from "@/components/ui/unsaved-guard";

const PRESET_COLORS = [
  "#3B82F6",
  "#6366F1",
  "#10B981",
  "#0EA5E9",
  "#8B5CF6",
  "#F59E0B",
  "#EF4444",
  "#0F172A",
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT_RE = /\.(svg|png|jpe?g|webp|ico)$/i;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const ASSET_SLOTS = [
  { key: "logo", labelKey: "logoLight", darkBg: false, wide: true },
  { key: "logo_dark", labelKey: "logoDark", darkBg: true, wide: true },
  { key: "icon", labelKey: "iconLight", darkBg: false, wide: false },
  { key: "icon_dark", labelKey: "iconDark", darkBg: true, wide: false },
  { key: "favicon", labelKey: "favicon", darkBg: false, wide: false },
];

const EMPTY_SLOT_FILES = {
  logo: null,
  logo_dark: null,
  icon: null,
  icon_dark: null,
  favicon: null,
};

const EMPTY_CLEARED = {
  logo: false,
  logo_dark: false,
  icon: false,
  icon_dark: false,
  favicon: false,
};

function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (HEX_COLOR_RE.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

function buildBaseline(source) {
  const name =
    typeof source?.name === "string" && source.name.trim()
      ? source.name.trim()
      : DEFAULT_BRANDING.name;
  const primaryColor =
    normalizeHex(source?.primary_color) ?? DEFAULT_BRANDING.primary_color;

  const resolved = {};
  const defaults = {};
  const hasCustom = {};

  for (const { key } of ASSET_SLOTS) {
    const fallback =
      typeof source?.defaults?.[key] === "string" && source.defaults[key].trim()
        ? source.defaults[key].trim()
        : DEFAULT_BRANDING[key];
    defaults[key] = fallback;

    const current =
      typeof source?.[key] === "string" && source[key].trim()
        ? source[key].trim()
        : fallback;
    resolved[key] = current;

    if (source?.custom && typeof source.custom === "object") {
      hasCustom[key] = Boolean(source.custom[key]);
    } else {
      hasCustom[key] = current !== fallback;
    }
  }

  return {
    name,
    primaryColor,
    resolved,
    defaults,
    hasCustom,
    centralActive: Boolean(source?.central_active),
  };
}

function AssetDropzone({
  slot,
  label,
  previewUrl,
  canReset,
  busy,
  uploadHint,
  resetLabel,
  invalidFileMessage,
  onSelectFile,
  onResetSlot,
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function validateAndEmit(file) {
    if (!file) return;
    if (!ALLOWED_EXT_RE.test(file.name) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      toast.error(invalidFileMessage);
      return;
    }
    onSelectFile(slot.key, file);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-muted/20 p-3.5 transition-colors",
        slot.wide && "sm:col-span-1",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </Label>
        {canReset ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => onResetSlot(slot.key)}
          >
            <RotateCcw className="size-3" aria-hidden />
            {resetLabel}
          </Button>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = event.dataTransfer?.files?.[0];
          validateAndEmit(file);
        }}
        className={cn(
          "relative flex min-h-24 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          slot.darkBg
            ? "border-slate-800 bg-slate-950 text-slate-100"
            : "border-border bg-white text-slate-900",
          dragging && "border-primary ring-2 ring-primary/30",
        )}
      >
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={label}
            className={cn(
              "object-contain select-none",
              slot.wide ? "max-h-12 max-w-full" : "size-10",
            )}
          />
        ) : (
          <ImageIcon className="size-6 opacity-40" aria-hidden />
        )}
      </button>

      <div className="flex items-center justify-between gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.webp,.ico"
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            validateAndEmit(file);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="w-full"
        >
          <Upload className="size-3" aria-hidden />
          {uploadHint}
        </Button>
      </div>
    </div>
  );
}

export function BrandingStudio({
  mode = "admin",
  initialBranding,
  onSuccess,
  onSkip,
}) {
  const t = useTranslations("branding");
  const tc = useTranslations("common");
  const contextBranding = useBranding();
  const { refreshAndWait } = useRefresh();

  const [baseline, setBaseline] = useState(() =>
    buildBaseline(initialBranding ?? contextBranding),
  );
  const [name, setName] = useState(() => baseline.name);
  const [hexInput, setHexInput] = useState(() => baseline.primaryColor);
  const [files, setFiles] = useState(EMPTY_SLOT_FILES);
  const [previews, setPreviews] = useState(EMPTY_SLOT_FILES);
  const [cleared, setCleared] = useState(EMPTY_CLEARED);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [previewTab, setPreviewTab] = useState("dashboard");

  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewsRef.current)) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, []);

  function revokeAllPreviews(currentPreviews) {
    for (const url of Object.values(currentPreviews)) {
      if (url) URL.revokeObjectURL(url);
    }
  }

  function applyBaselineFromResponse(nextBranding) {
    revokeAllPreviews(previewsRef.current);
    const next = buildBaseline(nextBranding);
    setBaseline(next);
    setName(next.name);
    setHexInput(next.primaryColor);
    setFiles(EMPTY_SLOT_FILES);
    setPreviews(EMPTY_SLOT_FILES);
    setCleared(EMPTY_CLEARED);
  }

  const normalizedHex = normalizeHex(hexInput);
  const isValidHex = Boolean(normalizedHex);
  const activeColor = normalizedHex ?? baseline.primaryColor;

  const isDirty =
    name.trim() !== baseline.name ||
    (isValidHex && activeColor !== baseline.primaryColor) ||
    Object.values(files).some(Boolean) ||
    Object.values(cleared).some(Boolean);

  useWatchUnsaved("branding-studio", mode === "admin" && isDirty);

  const activeAssets = useMemo(() => {
    const out = {};
    for (const { key } of ASSET_SLOTS) {
      if (previews[key]) {
        out[key] = previews[key];
      } else if (cleared[key]) {
        out[key] = baseline.defaults[key];
      } else {
        out[key] = baseline.resolved[key];
      }
    }
    return out;
  }, [baseline, cleared, previews]);

  const previewPalette = useMemo(() => generatePalette(activeColor), [activeColor]);
  const previewPrimary = previewPalette?.light?.primary ?? activeColor;
  const previewPrimaryFg = previewPalette?.light?.primaryForeground ?? "#FFFFFF";
  const displayName = name.trim() || DEFAULT_BRANDING.name;

  function handleSelectFile(key, file) {
    const nextUrl = URL.createObjectURL(file);
    setPreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]);
      return { ...prev, [key]: nextUrl };
    });
    setFiles((prev) => ({ ...prev, [key]: file }));
    setCleared((prev) => ({ ...prev, [key]: false }));
  }

  function handleResetSlot(key) {
    setPreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]);
      return { ...prev, [key]: null };
    });
    setFiles((prev) => ({ ...prev, [key]: null }));
    setCleared((prev) => ({ ...prev, [key]: baseline.hasCustom[key] }));
  }

  function handleDiscard() {
    revokeAllPreviews(previewsRef.current);
    setName(baseline.name);
    setHexInput(baseline.primaryColor);
    setFiles(EMPTY_SLOT_FILES);
    setPreviews(EMPTY_SLOT_FILES);
    setCleared(EMPTY_CLEARED);
  }

  function buildFormData() {
    const formData = new FormData();
    formData.append("name", name.trim() || DEFAULT_BRANDING.name);
    formData.append("primary_color", activeColor);
    for (const { key } of ASSET_SLOTS) {
      if (files[key]) {
        formData.append(key, files[key]);
      } else if (cleared[key]) {
        formData.append(`clear_${key}`, "1");
      }
    }
    return formData;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || !isValidHex) return;

    setSaving(true);
    try {
      const formData = buildFormData();
      if (mode === "setup") {
        await setupFirstRunBranding(formData);
        await revalidateBranding();
        await refreshAndWait();
        toast.success(t("saved"));
        onSuccess?.();
      } else {
        const { data } = await updateAdminBranding(formData);
        await revalidateBranding();
        await refreshAndWait();
        if (data?.branding) applyBaselineFromResponse(data.branding);
        toast.success(t("saved"));
      }
    } catch (error) {
      toast.error(apiMessage(error, t("saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetAll() {
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await resetAdminBranding();
      await revalidateBranding();
      await refreshAndWait();
      applyBaselineFromResponse(data?.branding ?? DEFAULT_BRANDING);
      setConfirmReset(false);
      toast.success(t("resetSuccess"));
    } catch (error) {
      toast.error(apiMessage(error, t("resetFailed")));
    } finally {
      setSaving(false);
    }
  }

  const nameInputId = useId();
  const colorInputId = useId();

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {baseline.centralActive ? <Note>{t("centralNotice")}</Note> : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className="border-b bg-[var(--card-head)] px-5 py-4">
                <CardTitle icon={Palette}>{t("identityTitle")}</CardTitle>
                <CardDescription>{t("identityDesc")}</CardDescription>
                {mode === "admin" ? (
                  <CardAction>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => setConfirmReset(true)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      {t("resetAll")}
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-5 px-5 py-5">
                <div className="space-y-2">
                  <Label htmlFor={nameInputId}>{t("nameLabel")}</Label>
                  <Input
                    id={nameInputId}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("namePlaceholder")}
                    maxLength={80}
                    disabled={saving}
                  />
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor={colorInputId}>{t("colorLabel")}</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={activeColor}
                      onChange={(event) => setHexInput(event.target.value.toUpperCase())}
                      aria-label={t("colorLabel")}
                      disabled={saving}
                      className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Input
                      id={colorInputId}
                      value={hexInput}
                      onChange={(event) => setHexInput(event.target.value)}
                      placeholder="#3B82F6"
                      maxLength={7}
                      aria-invalid={!isValidHex}
                      disabled={saving}
                      className="max-w-36 font-mono uppercase"
                    />
                  </div>
                  {!isValidHex ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t("invalidHex")}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("colorHint")}</p>
                  )}

                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("presetsLabel")}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_COLORS.map((preset) => {
                        const selected = activeColor === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            disabled={saving}
                            aria-label={preset}
                            aria-pressed={selected}
                            onClick={() => setHexInput(preset)}
                            style={{ backgroundColor: preset }}
                            className={cn(
                              "flex size-7 items-center justify-center rounded-full border border-black/15 text-white transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                              selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                            )}
                          >
                            {selected ? <Check className="size-3.5" aria-hidden /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className="border-b bg-[var(--card-head)] px-5 py-4">
                <CardTitle icon={ImageIcon}>{t("assetsTitle")}</CardTitle>
                <CardDescription>{t("assetsDesc")}</CardDescription>
              </CardHeader>

              <CardContent className="px-5 py-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {ASSET_SLOTS.map((slot) => {
                    const canReset =
                      Boolean(files[slot.key]) ||
                      (!cleared[slot.key] && baseline.hasCustom[slot.key]);
                    return (
                      <AssetDropzone
                        key={slot.key}
                        slot={slot}
                        label={t(slot.labelKey)}
                        previewUrl={activeAssets[slot.key]}
                        canReset={canReset}
                        busy={saving}
                        uploadHint={t("uploadHint")}
                        resetLabel={t("resetAsset")}
                        invalidFileMessage={t("invalidFile")}
                        onSelectFile={handleSelectFile}
                        onResetSlot={handleResetSlot}
                      />
                    );
                  })}
                </div>
              </CardContent>

              {mode === "admin" ? (
                <CardSaveFooter
                  saving={saving}
                  dirty={isDirty}
                  saveReason={
                    !isValidHex
                      ? t("invalidHex")
                      : !isDirty
                        ? tc("nothingToSave")
                        : null
                  }
                  onDiscard={handleDiscard}
                  submit
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
                  {onSkip ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={saving}
                      onClick={onSkip}
                    >
                      {t("setupSkip")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <ReasonTooltip reason={!isValidHex ? t("invalidHex") : null}>
                    <Button type="submit" disabled={saving || !isValidHex}>
                      {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      {t("setupSaveAndContinue")}
                    </Button>
                  </ReasonTooltip>
                </div>
              )}
            </Card>
          </div>

          <Card className="gap-0 overflow-hidden py-0 xl:sticky xl:top-6">
            <CardHeader className="border-b bg-[var(--card-head)] px-5 py-4">
              <CardTitle icon={Sparkles}>{t("previewTitle")}</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4 px-5 py-5">
              <Tabs value={previewTab} onValueChange={setPreviewTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="dashboard" className="flex-1">
                    {t("previewDashboard")}
                  </TabsTrigger>
                  <TabsTrigger value="login" className="flex-1">
                    {t("previewLogin")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="mt-3">
                  <div className="overflow-hidden rounded-xl border bg-background shadow-xs">
                    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="flex items-center gap-1" aria-hidden>
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                      </span>
                      <div className="flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeAssets.favicon}
                          alt=""
                          className="size-3.5 shrink-0 object-contain"
                        />
                        <span className="truncate font-medium">{displayName}</span>
                      </div>
                    </div>

                    <div className="grid min-h-56 grid-cols-[120px_1fr]">
                      <div className="flex flex-col gap-3 border-r border-slate-800 bg-slate-950 p-3 text-slate-100">
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activeAssets.logo_dark || activeAssets.logo}
                            alt={displayName}
                            className="h-5 max-w-full object-contain"
                          />
                        </div>
                        <div className="space-y-1.5 pt-1">
                          <div
                            className="rounded-md px-2 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: previewPrimary,
                              color: previewPrimaryFg,
                            }}
                          >
                            {t("previewDashboard")}
                          </div>
                          <div className="h-5 rounded-md bg-slate-900 px-2" />
                          <div className="h-5 rounded-md bg-slate-900 px-2" />
                        </div>
                      </div>

                      <div className="flex flex-col justify-between gap-4 bg-card p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={activeAssets.icon}
                              alt=""
                              className="size-5 shrink-0 object-contain dark:hidden"
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={activeAssets.icon_dark || activeAssets.icon}
                              alt=""
                              className="hidden size-5 shrink-0 object-contain dark:block"
                            />
                            <span className="truncate text-xs font-semibold">
                              {displayName}
                            </span>
                          </div>
                          <span
                            className="inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-xs font-medium shadow-xs"
                            style={{
                              backgroundColor: previewPrimary,
                              color: previewPrimaryFg,
                            }}
                          >
                            {t("previewButton")}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1.5 rounded-lg border p-2.5">
                            <div
                              className="h-1.5 w-8 rounded-full"
                              style={{ backgroundColor: previewPrimary }}
                            />
                            <div className="h-3 w-14 rounded bg-muted" />
                            <div className="h-2.5 w-10 rounded bg-muted/60" />
                          </div>
                          <div className="space-y-1.5 rounded-lg border p-2.5">
                            <div
                              className="h-1.5 w-8 rounded-full opacity-70"
                              style={{ backgroundColor: previewPrimary }}
                            />
                            <div className="h-3 w-12 rounded bg-muted" />
                            <div className="h-2.5 w-16 rounded bg-muted/60" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="login" className="mt-3">
                  <div className="overflow-hidden rounded-xl border bg-muted/30 shadow-xs">
                    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="flex items-center gap-1" aria-hidden>
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                      </span>
                      <div className="flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeAssets.favicon}
                          alt=""
                          className="size-3.5 shrink-0 object-contain"
                        />
                        <span className="truncate font-medium">{displayName}</span>
                      </div>
                    </div>

                    <div className="flex min-h-56 items-center justify-center p-5">
                      <div className="w-full max-w-64 space-y-3 rounded-xl border bg-card p-4 shadow-xs">
                        <div className="flex flex-col items-center gap-1.5 text-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activeAssets.logo}
                            alt={displayName}
                            className="h-7 max-w-full object-contain dark:hidden"
                          />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activeAssets.logo_dark || activeAssets.logo}
                            alt={displayName}
                            className="hidden h-7 max-w-full object-contain dark:block"
                          />
                          <p className="text-xs font-medium text-muted-foreground">
                            {displayName}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="h-7 rounded-md border bg-muted/30" />
                          <div className="h-7 rounded-md border bg-muted/30" />
                        </div>
                        <div
                          className="flex h-8 w-full items-center justify-center rounded-md text-xs font-medium shadow-xs"
                          style={{
                            backgroundColor: previewPrimary,
                            color: previewPrimaryFg,
                          }}
                        >
                          {t("previewButton")}
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirmReset(false);
        }}
        icon={RotateCcw}
        tone="destructive"
        title={t("resetConfirmTitle")}
        description={t("resetConfirmDesc")}
        confirmLabel={t("resetConfirmAction")}
        pending={saving}
        onConfirm={handleResetAll}
      />
    </>
  );
}
