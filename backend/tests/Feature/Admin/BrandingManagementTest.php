<?php

use App\Models\ActivityLog;
use App\Models\User;
use App\Services\Panel\PanelBranding;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

function validSvg(string $fill = '#3B82F6'): UploadedFile
{
    return UploadedFile::fake()->createWithContent(
        'logo.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="'.$fill.'"/></svg>',
    );
}

function validPng(string $name = 'logo.png'): UploadedFile
{
    return UploadedFile::fake()->createWithContent(
        $name,
        (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
    );
}

beforeEach(function (): void {
    File::deleteDirectory(storage_path('app/branding'));
});

afterEach(function (): void {
    File::deleteDirectory(storage_path('app/branding'));
});

describe('first-run branding setup', function (): void {
    it('configures branding before any human user exists, even when a system user is present', function (): void {
        User::factory()->create(['is_system' => true]);

        $response = $this->post('/api/branding/setup', [
            'name' => 'Acme Cloud',
            'primary_color' => '#10B981',
            'logo' => validSvg('#10B981'),
        ], ['Accept' => 'application/json']);

        $response->assertOk()
            ->assertJsonPath('branding.name', 'Acme Cloud')
            ->assertJsonPath('branding.primary_color', '#10B981')
            ->assertJsonPath('branding.source', 'panel');

        $logoUrl = $response->json('branding.logo');
        expect($logoUrl)->toStartWith('http://localhost/api/branding/assets/logo-')
            ->and($logoUrl)->toEndWith('.svg');

        $this->getJson('/api/branding')
            ->assertOk()
            ->assertJsonPath('branding.name', 'Acme Cloud')
            ->assertJsonPath('branding.primary_color', '#10B981')
            ->assertJsonPath('branding.logo', $logoUrl);

        $assetPath = parse_url((string) $logoUrl, PHP_URL_PATH);
        $assetResponse = $this->get((string) $assetPath);

        $assetResponse->assertOk()
            ->assertHeader('Content-Type', 'image/svg+xml')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        expect((string) $assetResponse->headers->get('Cache-Control'))
            ->toContain('public')
            ->toContain('max-age=31536000')
            ->toContain('immutable');
    });

    it('rejects first-run setup with 403 once a human user exists', function (): void {
        User::factory()->admin()->create();

        $this->postJson('/api/branding/setup', [
            'name' => 'Hijacked Panel',
            'primary_color' => '#FF0000',
        ])->assertForbidden();

        $this->getJson('/api/branding')
            ->assertOk()
            ->assertJsonPath('branding.name', 'Control Panel');
    });

    it('validates hex color and rejects unsafe SVG on first-run setup', function (): void {
        $this->postJson('/api/branding/setup', [
            'primary_color' => 'not-a-color',
        ])->assertUnprocessable()->assertJsonValidationErrors('primary_color');

        $unsafeSvg = UploadedFile::fake()->createWithContent(
            'logo.svg',
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );

        $this->post('/api/branding/setup', [
            'logo' => $unsafeSvg,
        ], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');
    });
});

describe('admin branding management', function (): void {
    beforeEach(function (): void {
        $this->admin = User::factory()->admin()->create();
    });

    it('requires authentication for admin branding endpoints', function (): void {
        $this->getJson('/api/admin/branding')->assertUnauthorized();
        $this->postJson('/api/admin/branding', ['name' => 'Test'])->assertUnauthorized();
        $this->deleteJson('/api/admin/branding')->assertUnauthorized();
    });

    it('forbids non-admin users from managing branding', function (): void {
        $user = User::factory()->create();

        $this->actingAs($user)->getJson('/api/admin/branding')->assertForbidden();
        $this->actingAs($user)->postJson('/api/admin/branding', ['name' => 'Test'])->assertForbidden();
        $this->actingAs($user)->deleteJson('/api/admin/branding')->assertForbidden();
    });

    it('returns resolved, custom, defaults, and central_active status', function (): void {
        config(['central.url' => '']);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.name', 'Control Panel')
            ->assertJsonPath('branding.primary_color', '#3B82F6')
            ->assertJsonPath('branding.custom.name', null)
            ->assertJsonPath('branding.custom.primary_color', null)
            ->assertJsonPath('branding.custom.logo', null)
            ->assertJsonPath('branding.defaults.name', 'Control Panel')
            ->assertJsonPath('branding.central_active', false);

        config(['central.url' => 'https://central.test']);
        Cache::flush();
        Http::fake([
            'central.test/api/v1/site-settings' => Http::response(['data' => ['name' => 'Reseller Central']]),
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.central_active', true);
    });

    it('uploads and serves SVG, PNG, and ICO assets, replaces old files, and logs activity', function (): void {
        $first = $this->actingAs($this->admin)->post('/api/admin/branding', [
            'name' => 'Nova Host',
            'primary_color' => '#2563EB',
            'logo' => validSvg(),
            'logo_dark' => validPng('dark.png'),
            'icon' => validPng('icon.png'),
            'icon_dark' => validSvg('#FFFFFF'),
            'favicon' => UploadedFile::fake()->create('favicon.ico', 1, 'image/x-icon'),
        ], ['Accept' => 'application/json']);

        $first->assertOk()
            ->assertJsonPath('branding.name', 'Nova Host')
            ->assertJsonPath('branding.primary_color', '#2563EB')
            ->assertJsonPath('branding.custom.name', 'Nova Host')
            ->assertJsonPath('branding.custom.primary_color', '#2563EB');

        $firstLogoFilename = basename((string) parse_url((string) $first->json('branding.logo'), PHP_URL_PATH));
        $pngUrl = (string) $first->json('branding.logo_dark');
        $icoUrl = (string) $first->json('branding.favicon');

        expect(is_file(storage_path('app/branding/'.$firstLogoFilename)))->toBeTrue();

        $this->get((string) parse_url($pngUrl, PHP_URL_PATH))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->get((string) parse_url($icoUrl, PHP_URL_PATH))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/x-icon')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        // Replacing the logo deletes the superseded file from disk.
        $second = $this->actingAs($this->admin)->post('/api/admin/branding', [
            'logo' => validPng('replacement.png'),
        ], ['Accept' => 'application/json']);

        $second->assertOk()
            ->assertJsonPath('branding.name', 'Nova Host');

        $secondLogoFilename = basename((string) parse_url((string) $second->json('branding.logo'), PHP_URL_PATH));

        expect($secondLogoFilename)->not->toBe($firstLogoFilename)
            ->and(is_file(storage_path('app/branding/'.$firstLogoFilename)))->toBeFalse()
            ->and(is_file(storage_path('app/branding/'.$secondLogoFilename)))->toBeTrue();

        expect(ActivityLog::where('type', 'setting')->where('action', 'branding_updated')->count())->toBe(2);
    });

    it('clears individual branding fields and deletes cleared asset files', function (): void {
        $initial = $this->actingAs($this->admin)->post('/api/admin/branding', [
            'name' => 'Custom Cloud',
            'primary_color' => '#EF4444',
            'logo' => validPng(),
        ], ['Accept' => 'application/json'])->assertOk();

        $logoFilename = basename((string) parse_url((string) $initial->json('branding.logo'), PHP_URL_PATH));
        expect(is_file(storage_path('app/branding/'.$logoFilename)))->toBeTrue();

        $cleared = $this->actingAs($this->admin)->post('/api/admin/branding', [
            'clear_logo' => 'true',
            'clear_primary_color' => '1',
        ], ['Accept' => 'application/json']);

        $cleared->assertOk()
            ->assertJsonPath('branding.name', 'Custom Cloud')
            ->assertJsonPath('branding.primary_color', '#3B82F6')
            ->assertJsonPath('branding.custom.primary_color', null)
            ->assertJsonPath('branding.logo', '/brand/panel-horizontal-light.svg')
            ->assertJsonPath('branding.custom.logo', null);

        expect(is_file(storage_path('app/branding/'.$logoFilename)))->toBeFalse();
    });

    it('rejects unsafe SVGs with 422', function (string $maliciousSvg): void {
        $file = UploadedFile::fake()->createWithContent('logo.svg', $maliciousSvg);

        $this->actingAs($this->admin)
            ->post('/api/admin/branding', ['logo' => $file], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');
    })->with([
        'script tag' => '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'onload attribute' => '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>',
        'javascript href' => '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
        'foreignObject' => '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe/></body></foreignObject></svg>',
    ]);

    it('rejects invalid hex colors and invalid file types with 422', function (): void {
        $this->actingAs($this->admin)
            ->postJson('/api/admin/branding', ['primary_color' => '#FFF'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('primary_color');

        $this->actingAs($this->admin)
            ->postJson('/api/admin/branding', ['primary_color' => 'red'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('primary_color');

        $phpFile = UploadedFile::fake()->createWithContent('shell.php', '<?php echo 1;');
        $this->actingAs($this->admin)
            ->post('/api/admin/branding', ['logo' => $phpFile], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');

        $disguisedPng = UploadedFile::fake()->createWithContent('fake.png', 'plain text not png');
        $this->actingAs($this->admin)
            ->post('/api/admin/branding', ['logo' => $disguisedPng], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');
    });

    it('rejects path traversal and missing asset filenames with 404', function (): void {
        $panelBranding = app(PanelBranding::class);

        expect($panelBranding->assetPath('..'))->toBeNull()
            ->and($panelBranding->assetPath('../.env'))->toBeNull()
            ->and($panelBranding->assetPath('..\\secret.svg'))->toBeNull()
            ->and($panelBranding->assetPath('missing-123456789012.svg'))->toBeNull();

        $this->get('/api/branding/assets/..')->assertNotFound();
        $this->get('/api/branding/assets/..%2F..%2F.env')->assertNotFound();
        $this->get('/api/branding/assets/nonexistent-abcdef123456.svg')->assertNotFound();
    });

    it('resets all custom branding fields and deletes stored assets', function (): void {
        $uploaded = $this->actingAs($this->admin)->post('/api/admin/branding', [
            'name' => 'Temp Brand',
            'primary_color' => '#9333EA',
            'logo' => validSvg('#9333EA'),
            'favicon' => validPng('favicon.png'),
        ], ['Accept' => 'application/json'])->assertOk();

        $logoFilename = basename((string) parse_url((string) $uploaded->json('branding.logo'), PHP_URL_PATH));
        expect(is_file(storage_path('app/branding/'.$logoFilename)))->toBeTrue();

        $reset = $this->actingAs($this->admin)
            ->deleteJson('/api/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.name', 'Control Panel')
            ->assertJsonPath('branding.primary_color', '#3B82F6')
            ->assertJsonPath('branding.logo', '/brand/panel-horizontal-light.svg')
            ->assertJsonPath('branding.custom.name', null)
            ->assertJsonPath('branding.custom.primary_color', null)
            ->assertJsonPath('branding.custom.logo', null)
            ->assertJsonPath('branding.custom.favicon', null);

        $reset->assertOk();

        expect(is_file(storage_path('app/branding/'.$logoFilename)))->toBeFalse()
            ->and(File::files(storage_path('app/branding')))->toBe([]);

        $row = DB::table('settings')->where('id', 1)->first();
        expect($row->brand_name)->toBeNull()
            ->and($row->brand_primary_color)->toBeNull()
            ->and($row->brand_logo)->toBeNull()
            ->and($row->brand_favicon)->toBeNull()
            ->and($row->brand_updated_at)->toBeNull();

        expect(ActivityLog::where('type', 'setting')->where('action', 'branding_reset')->exists())->toBeTrue();

        $this->getJson('/api/branding')
            ->assertOk()
            ->assertJsonPath('branding.name', 'Control Panel')
            ->assertJsonPath('branding.primary_color', '#3B82F6');
    });
});
