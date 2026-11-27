<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('settings', function (Blueprint $table): void {
            $table->string('brand_name', 80)->nullable();
            $table->string('brand_primary_color', 16)->nullable();
            $table->string('brand_logo', 255)->nullable();
            $table->string('brand_logo_dark', 255)->nullable();
            $table->string('brand_icon', 255)->nullable();
            $table->string('brand_icon_dark', 255)->nullable();
            $table->string('brand_favicon', 255)->nullable();
            $table->timestamp('brand_updated_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('settings', function (Blueprint $table): void {
            $table->dropColumn([
                'brand_name',
                'brand_primary_color',
                'brand_logo',
                'brand_logo_dark',
                'brand_icon',
                'brand_icon_dark',
                'brand_favicon',
                'brand_updated_at',
            ]);
        });
    }
};
