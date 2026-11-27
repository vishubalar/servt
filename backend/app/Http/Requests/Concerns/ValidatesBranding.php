<?php

namespace App\Http\Requests\Concerns;

use App\Services\Panel\PanelBranding;
use Closure;
use Illuminate\Http\UploadedFile;

/**
 * Shared validation rules and payload extraction for updating panel branding
 * from both the first-run setup flow and the admin branding studio.
 */
trait ValidatesBranding
{
    protected function prepareForValidation(): void
    {
        $normalized = [];

        foreach (['name', 'primary_color', ...array_keys(PanelBranding::SLOTS)] as $field) {
            $key = 'clear_'.$field;

            if (! $this->has($key)) {
                continue;
            }

            $value = $this->input($key);

            if (is_string($value)) {
                $lower = strtolower(trim($value));

                if ($lower === 'true') {
                    $normalized[$key] = true;
                } elseif ($lower === 'false') {
                    $normalized[$key] = false;
                }
            }
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $fileRules = [
            'nullable',
            'file',
            'max:2048',
            'mimetypes:image/svg+xml,image/svg,text/plain,text/xml,application/xml,image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon',
            function (string $attribute, mixed $value, Closure $fail): void {
                if (! $value instanceof UploadedFile) {
                    return;
                }

                $extension = strtolower($value->getClientOriginalExtension());

                if (! in_array($extension, PanelBranding::ALLOWED_EXTENSIONS, true)) {
                    $fail(__('validation.mimes', [
                        'attribute' => $attribute,
                        'values' => implode(', ', PanelBranding::ALLOWED_EXTENSIONS),
                    ]));

                    return;
                }

                $mime = strtolower((string) $value->getMimeType());
                $svgMimes = ['image/svg+xml', 'image/svg', 'text/plain', 'text/xml', 'application/xml'];

                if ($extension !== 'svg' && in_array($mime, ['text/plain', 'text/xml', 'application/xml'], true)) {
                    $fail(__('validation.mimes', [
                        'attribute' => $attribute,
                        'values' => implode(', ', PanelBranding::ALLOWED_EXTENSIONS),
                    ]));

                    return;
                }

                if ($extension === 'svg' && ! in_array($mime, $svgMimes, true)) {
                    $fail(__('validation.mimes', [
                        'attribute' => $attribute,
                        'values' => 'svg',
                    ]));
                }
            },
        ];

        $rules = [
            'name' => ['nullable', 'string', 'max:80'],
            'primary_color' => ['nullable', 'string', 'regex:/\A#[0-9a-fA-F]{6}\z/'],
            'clear_name' => ['sometimes', 'boolean'],
            'clear_primary_color' => ['sometimes', 'boolean'],
        ];

        foreach (array_keys(PanelBranding::SLOTS) as $slot) {
            $rules[$slot] = $fileRules;
            $rules['clear_'.$slot] = ['sometimes', 'boolean'];
        }

        return $rules;
    }

    /**
     * @return array<string, mixed>
     */
    public function brandingAttributes(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = (array) $this->validated();
        $attributes = [];

        foreach (['name', 'primary_color'] as $field) {
            if (array_key_exists($field, $validated)) {
                $attributes[$field] = $validated[$field];
            }
        }

        return $attributes;
    }

    /**
     * @return array<string, UploadedFile>
     */
    public function brandingFiles(): array
    {
        $files = [];

        foreach (array_keys(PanelBranding::SLOTS) as $slot) {
            $file = $this->file($slot);

            if ($file instanceof UploadedFile) {
                $files[$slot] = $file;
            }
        }

        return $files;
    }

    /**
     * @return array<string, bool>
     */
    public function brandingClears(): array
    {
        $clears = [];

        foreach (['name', 'primary_color', ...array_keys(PanelBranding::SLOTS)] as $field) {
            $clears[$field] = $this->boolean('clear_'.$field);
        }

        return $clears;
    }
}
