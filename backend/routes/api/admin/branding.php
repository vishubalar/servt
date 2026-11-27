<?php

use App\Http\Controllers\API\Admin\BrandingController;
use Illuminate\Support\Facades\Route;

Route::get('/branding', [BrandingController::class, 'show']);
Route::post('/branding', [BrandingController::class, 'update']);
Route::delete('/branding', [BrandingController::class, 'reset']);
