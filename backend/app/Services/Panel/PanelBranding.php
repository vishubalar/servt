<?php

namespace App\Services\Panel;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Panel-level white-label branding stored in the singleton `settings` row (`id = 1`)
 * and custom uploaded image assets under `storage/app/branding`.
 *
 * Config values in `config/branding.php` act as defaults; DB values and stored assets
 * overlay them one field at a time when present and valid.
 */
class PanelBranding
{
    /** @var array<string, string> */
    public const SLOTS = [
        'logo' => 'brand_logo',
        'logo_dark' => 'brand_logo_dark',
        'icon' => 'brand_icon',
        'icon_dark' => 'brand_icon_dark',
        'favicon' => 'brand_favicon',
    ];

    /** @var list<string> */
    public const ALLOWED_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'ico'];

    /** @var array<string, string> */
    public const MIME_MAP = [
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
        'ico' => 'image/x-icon',
    ];

    public function directory(): string
    {
        return storage_path('app/branding');
    }

    /**
     * Resolved branding (config defaults overlaid with valid DB custom overrides).
     *
     * @return array{name: string, logo: string, logo_dark: string, icon: string, icon_dark: string, favicon: string, primary_color: string}
     */
    public function resolved(?string $origin = null): array
    {
        $custom = $this->custom($origin);

        return [
            'name' => $custom['name'] ?? (trim((string) config('branding.name', '')) ?: 'Control Panel'),
            'logo' => $custom['logo'] ?? (string) config('branding.logo', '/brand/panel-horizontal-light.svg'),
            'logo_dark' => $custom['logo_dark'] ?? (string) config('branding.logo_dark', '/brand/panel-horizontal-dark.svg'),
            'icon' => $custom['icon'] ?? (string) config('branding.icon', '/brand/panel-mark-light.svg'),
            'icon_dark' => $custom['icon_dark'] ?? (string) config('branding.icon_dark', '/brand/panel-mark-dark.svg'),
            'favicon' => $custom['favicon'] ?? (string) config('branding.favicon', '/brand/panel-favicon.svg'),
            'primary_color' => $custom['primary_color'] ?? (string) config('branding.primary_color', '#3B82F6'),
        ];
    }

    /**
     * Raw custom DB overrides (null for any field or asset not currently overridden).
     *
     * @return array{name: ?string, primary_color: ?string, logo: ?string, logo_dark: ?string, icon: ?string, icon_dark: ?string, favicon: ?string}
     */
    public function custom(?string $origin = null): array
    {
        $row = $this->row();

        $name = null;
        $rawName = $row['brand_name'] ?? null;
        if (is_string($rawName) && trim($rawName) !== '') {
            $name = mb_substr(trim($rawName), 0, 80);
        }

        $primaryColor = null;
        $rawColor = $row['brand_primary_color'] ?? null;
        if (is_string($rawColor) && preg_match('/\A#[0-9a-fA-F]{6}\z/', $rawColor) === 1) {
            $primaryColor = $rawColor;
        }

        return [
            'name' => $name,
            'primary_color' => $primaryColor,
            'logo' => $this->customAsset($row, 'logo', $origin),
            'logo_dark' => $this->customAsset($row, 'logo_dark', $origin),
            'icon' => $this->customAsset($row, 'icon', $origin),
            'icon_dark' => $this->customAsset($row, 'icon_dark', $origin),
            'favicon' => $this->customAsset($row, 'favicon', $origin),
        ];
    }

    public function assetUrl(string $filename, ?string $origin = null): string
    {
        $base = $origin !== null && $origin !== ''
            ? rtrim($origin, '/')
            : rtrim((string) config('app.url'), '/');

        if ($base === '') {
            return url('/api/branding/assets/'.$filename);
        }

        return $base.'/api/branding/assets/'.$filename;
    }

    public function assetPath(string $filename): ?string
    {
        if (preg_match('/\A[a-z0-9_-]+\.(?:svg|png|jpe?g|webp|ico)\z/', $filename) !== 1) {
            return null;
        }

        $path = $this->directory().DIRECTORY_SEPARATOR.$filename;

        return is_file($path) ? $path : null;
    }

    /**
     * Update custom panel branding attributes and/or uploaded asset slots.
     *
     * @param  array<string, mixed>  $attributes
     * @param  array<string, UploadedFile>  $files
     * @param  array<string, bool>  $clear
     *
     * @throws ValidationException
     */
    public function update(array $attributes, array $files = [], array $clear = []): void
    {
        $existing = $this->row();
        $updates = [];

        if ($clear['name'] ?? false) {
            $updates['brand_name'] = null;
        } elseif (array_key_exists('name', $attributes)) {
            $name = is_string($attributes['name']) ? trim($attributes['name']) : '';
            $updates['brand_name'] = $name === '' ? null : mb_substr($name, 0, 80);
        }

        if ($clear['primary_color'] ?? false) {
            $updates['brand_primary_color'] = null;
        } elseif (array_key_exists('primary_color', $attributes)) {
            $color = is_string($attributes['primary_color']) ? trim($attributes['primary_color']) : '';

            if ($color === '') {
                $updates['brand_primary_color'] = null;
            } elseif (preg_match('/\A#[0-9a-fA-F]{6}\z/', $color) !== 1) {
                throw ValidationException::withMessages([
                    'primary_color' => [__('validation.regex', ['attribute' => 'primary_color'])],
                ]);
            } else {
                $updates['brand_primary_color'] = $color;
            }
        }

        $pendingWrites = [];
        $filesToDelete = [];

        foreach (self::SLOTS as $slot => $column) {
            $file = $files[$slot] ?? null;

            if ($file instanceof UploadedFile) {
                $prepared = $this->prepareUpload($slot, $file);
                $pendingWrites[$prepared['filename']] = $prepared['contents'];
                $updates[$column] = $prepared['filename'];

                $previous = $existing[$column] ?? null;
                if (is_string($previous) && $previous !== '') {
                    $filesToDelete[] = $previous;
                }
            } elseif ($clear[$slot] ?? false) {
                $updates[$column] = null;

                $previous = $existing[$column] ?? null;
                if (is_string($previous) && $previous !== '') {
                    $filesToDelete[] = $previous;
                }
            }
        }

        if ($pendingWrites !== []) {
            $directory = $this->directory();
            File::ensureDirectoryExists($directory);

            $written = [];

            try {
                foreach ($pendingWrites as $filename => $contents) {
                    $target = $directory.DIRECTORY_SEPARATOR.$filename;

                    if (File::put($target, $contents) === false) {
                        throw new RuntimeException("Unable to store branding asset [{$filename}].");
                    }

                    $written[] = $target;
                }

                $this->persist($updates);
            } catch (Throwable $e) {
                foreach ($written as $path) {
                    @unlink($path);
                }

                throw $e;
            }
        } else {
            $this->persist($updates);
        }

        foreach ($filesToDelete as $oldFilename) {
            $this->deleteAssetFile($oldFilename);
        }
    }

    public function reset(): void
    {
        $existing = $this->row();

        if ($existing !== null) {
            foreach (self::SLOTS as $column) {
                $filename = $existing[$column] ?? null;

                if (is_string($filename)) {
                    $this->deleteAssetFile($filename);
                }
            }
        }

        $directory = $this->directory();

        if (is_dir($directory)) {
            $slotsPattern = implode('|', array_map(
                static fn (string $slot): string => preg_quote($slot, '/'),
                array_keys(self::SLOTS),
            ));

            foreach (File::files($directory) as $file) {
                if (preg_match('/\A(?:'.$slotsPattern.')-[a-z0-9]+\.(?:svg|png|jpe?g|webp|ico)\z/', $file->getFilename()) === 1) {
                    @unlink($file->getPathname());
                }
            }
        }

        DB::table('settings')->updateOrInsert(
            ['id' => 1],
            [
                'brand_name' => null,
                'brand_primary_color' => null,
                'brand_logo' => null,
                'brand_logo_dark' => null,
                'brand_icon' => null,
                'brand_icon_dark' => null,
                'brand_favicon' => null,
                'brand_updated_at' => null,
                'updated_at' => now(),
            ],
        );
    }

    /**
     * @param  array<string, mixed>|null  $row
     */
    private function customAsset(?array $row, string $slot, ?string $origin): ?string
    {
        $column = self::SLOTS[$slot];
        $filename = $row[$column] ?? null;

        return is_string($filename) && $this->assetPath($filename) !== null
            ? $this->assetUrl($filename, $origin)
            : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function row(): ?array
    {
        $row = DB::table('settings')->where('id', 1)->first([
            'brand_name',
            'brand_primary_color',
            'brand_logo',
            'brand_logo_dark',
            'brand_icon',
            'brand_icon_dark',
            'brand_favicon',
            'brand_updated_at',
        ]);

        return $row === null ? null : (array) $row;
    }

    /**
     * @param  array<string, mixed>  $updates
     */
    private function persist(array $updates): void
    {
        $now = now();

        DB::table('settings')->updateOrInsert(
            ['id' => 1],
            [
                ...$updates,
                'brand_updated_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    /**
     * @return array{filename: string, contents: string}
     *
     * @throws ValidationException
     */
    private function prepareUpload(string $slot, UploadedFile $file): array
    {
        $extension = strtolower($file->getClientOriginalExtension() ?: ($file->guessExtension() ?? ''));

        if (! in_array($extension, self::ALLOWED_EXTENSIONS, true)) {
            throw ValidationException::withMessages([
                $slot => [__('validation.mimes', [
                    'attribute' => $slot,
                    'values' => implode(', ', self::ALLOWED_EXTENSIONS),
                ])],
            ]);
        }

        $realPath = $file->getRealPath();
        $contents = is_string($realPath) && $realPath !== '' ? file_get_contents($realPath) : false;

        if ($contents === false) {
            throw ValidationException::withMessages([
                $slot => [__('validation.uploaded', ['attribute' => $slot])],
            ]);
        }

        if ($extension === 'svg' && $this->hasUnsafeSvgContent($contents)) {
            throw ValidationException::withMessages([
                $slot => [__('validation.branding_unsafe_svg', ['attribute' => $slot])],
            ]);
        }

        return [
            'filename' => sprintf('%s-%s.%s', $slot, strtolower(Str::random(12)), $extension),
            'contents' => $contents,
        ];
    }

    private function hasUnsafeSvgContent(string $contents): bool
    {
        $normalized = html_entity_decode(str_replace("\0", '', $contents), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        foreach ([$contents, $normalized] as $candidate) {
            if (
                preg_match('/<\s*(?:[a-z0-9_-]+:)?script\b/i', $candidate) === 1
                || preg_match('/\bon[a-z]+\s*=/i', $candidate) === 1
                || preg_match('/(?:javascript|vbscript)\s*:/i', $candidate) === 1
                || preg_match('/data\s*:\s*text\/html/i', $candidate) === 1
                || preg_match('/<\s*(?:[a-z0-9_-]+:)?foreignObject\b/i', $candidate) === 1
            ) {
                return true;
            }
        }

        return false;
    }

    private function deleteAssetFile(?string $filename): void
    {
        if (! is_string($filename) || $filename === '') {
            return;
        }

        $path = $this->assetPath($filename);

        if ($path !== null) {
            @unlink($path);
        }
    }
}
