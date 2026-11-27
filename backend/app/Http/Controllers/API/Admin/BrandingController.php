<?php

namespace App\Http\Controllers\API\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateBrandingRequest;
use App\Services\ActivityLogger;
use App\Services\Central\CentralBranding;
use App\Services\Panel\PanelBranding;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BrandingController extends Controller
{
    public function show(Request $request, PanelBranding $panelBranding, CentralBranding $central): JsonResponse
    {
        return response()->json([
            'branding' => $this->payload($request, $panelBranding, $central),
        ]);
    }

    public function update(
        UpdateBrandingRequest $request,
        PanelBranding $panelBranding,
        CentralBranding $central,
        ActivityLogger $activity,
    ): JsonResponse {
        $panelBranding->update(
            $request->brandingAttributes(),
            $request->brandingFiles(),
            $request->brandingClears(),
        );

        $activity->log('setting.branding_updated');

        return response()->json([
            'branding' => $this->payload($request, $panelBranding, $central),
        ]);
    }

    public function reset(
        Request $request,
        PanelBranding $panelBranding,
        CentralBranding $central,
        ActivityLogger $activity,
    ): JsonResponse {
        $panelBranding->reset();

        $activity->log('setting.branding_reset');

        return response()->json([
            'branding' => $this->payload($request, $panelBranding, $central),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Request $request, PanelBranding $panelBranding, CentralBranding $central): array
    {
        $origin = $request->getSchemeAndHttpHost();

        return [
            ...$panelBranding->resolved($origin),
            'custom' => $panelBranding->custom($origin),
            'defaults' => config('branding'),
            'central_active' => $central->fetch() !== null,
        ];
    }
}
