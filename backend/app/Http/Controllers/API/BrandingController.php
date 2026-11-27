<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\Branding\FirstRunBrandingRequest;
use App\Services\Central\CentralBranding;
use App\Services\Panel\PanelBranding;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class BrandingController extends Controller
{
    public function index(Request $request, PanelBranding $panelBranding, CentralBranding $central): JsonResponse
    {
        return response()->json([
            'branding' => $this->payload($request, $panelBranding, $central),
        ]);
    }

    public function asset(string $filename, PanelBranding $panelBranding): BinaryFileResponse
    {
        $path = $panelBranding->assetPath($filename);

        if ($path === null) {
            abort(404);
        }

        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = PanelBranding::MIME_MAP[$extension] ?? 'application/octet-stream';

        return response()->file($path, [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]);
    }

    public function setup(FirstRunBrandingRequest $request, PanelBranding $panelBranding, CentralBranding $central): JsonResponse
    {
        $panelBranding->update(
            $request->brandingAttributes(),
            $request->brandingFiles(),
            $request->brandingClears(),
        );

        return response()->json([
            'branding' => $this->payload($request, $panelBranding, $central),
        ]);
    }

    /**
     * The panel's branding, Central's where Central publishes it (2026-10-20).
     *
     * Resolves DB overrides over config/branding.php defaults first, then overlays
     * Central's name, logo, icon, favicon and colour where Central has a usable
     * value. Central has no dark-mode logo or icon, so `logo_dark` / `icon_dark`
     * stay the panel's — unless Central set a logo, which then stands in for both
     * rather than pairing a reseller's light logo with ours in dark mode.
     *
     * @return array<string, mixed>
     */
    private function payload(Request $request, PanelBranding $panelBranding, CentralBranding $central): array
    {
        $branding = $panelBranding->resolved($request->getSchemeAndHttpHost());
        $fromCentral = $central->fetch();

        if ($fromCentral !== null) {
            foreach (['name', 'logo', 'icon', 'favicon', 'primary_color'] as $key) {
                if (isset($fromCentral[$key])) {
                    $branding[$key] = $fromCentral[$key];
                }
            }

            if (isset($fromCentral['logo'])) {
                $branding['logo_dark'] = $fromCentral['logo'];
            }

            if (isset($fromCentral['icon'])) {
                $branding['icon_dark'] = $fromCentral['icon'];
            }
        }

        return [
            ...$branding,
            'tag_line' => $fromCentral['tag_line'] ?? null,
            'links' => $fromCentral['links'] ?? null,
            'display_message' => $fromCentral['display_message'] ?? null,
            'source' => $fromCentral === null ? 'panel' : 'central',
        ];
    }
}
