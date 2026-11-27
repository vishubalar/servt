<?php

use App\Http\Controllers\API\BrandingController;
use Illuminate\Support\Facades\Route;

Route::get('/branding', [BrandingController::class, 'index']);
Route::get('/branding/assets/{filename}', [BrandingController::class, 'asset']);
Route::post('/branding/setup', [BrandingController::class, 'setup'])
    ->middleware('throttle:login');
