<?php

return [

    /*
     * `?:` rather than only an `env()` default, because the two differ for the
     * case that reaches users: `BRANDING_NAME=` with nothing after it is a
     * *set* variable, so env()'s default never applies and the name resolves
     * to an empty string. That is not hypothetical — every consumer then has
     * to invent its own fallback, and the one in GoogleDriveWorkspace put this
     * product's name inside `app/`, where WhiteLabelTest forbids it, and from
     * there onto a folder created in a customer's personal Google Drive.
     *
     * Resolved once, here. This is the file a deployment is meant to override
     * and the only one exempt from the white-label check, so it is the correct
     * — and the only correct — place for the literal to live.
     */
    'name' => trim((string) env('BRANDING_NAME')) ?: 'Control Panel',

    'logo' => env('BRANDING_LOGO', '/brand/panel-horizontal-light.svg'),

    'logo_dark' => env('BRANDING_LOGO_DARK', '/brand/panel-horizontal-dark.svg'),

    'icon' => env('BRANDING_ICON', '/brand/panel-mark-light.svg'),

    'icon_dark' => env('BRANDING_ICON_DARK', '/brand/panel-mark-dark.svg'),

    'favicon' => env('BRANDING_FAVICON', '/brand/panel-favicon.svg'),

    'primary_color' => env('BRANDING_PRIMARY_COLOR', '#3B82F6'),

];
