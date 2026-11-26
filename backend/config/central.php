<?php

return [

    /*
     * Central's own address. install.sh writes it when Central installs the
     * server; empty (the default) turns Central off and the panel keeps its
     * own branding (config/branding.php).
     *
     * Set CENTRAL_URL to your Central server's base URL (e.g.
     * https://central.example.com) to enable Central branding and management;
     * Central must expose GET /api/v1/site-settings.
     */
    'url' => rtrim((string) env('CENTRAL_URL', ''), '/'),

    // How long Central's public branding is kept before it is asked again,
    // and how long a failed fetch is remembered so a Central that is down is
    // not asked on every page load.
    'branding_cache_seconds' => (int) env('CENTRAL_BRANDING_CACHE_SECONDS', 3600),
    'branding_retry_seconds' => (int) env('CENTRAL_BRANDING_RETRY_SECONDS', 300),

];
