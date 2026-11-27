<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\Concerns\ValidatesBranding;
use Illuminate\Foundation\Http\FormRequest;

class UpdateBrandingRequest extends FormRequest
{
    use ValidatesBranding;

    public function authorize(): bool
    {
        return true;
    }
}
