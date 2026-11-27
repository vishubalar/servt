<?php

namespace App\Http\Requests\Branding;

use App\Http\Requests\Concerns\ValidatesBranding;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Http\FormRequest;

class FirstRunBrandingRequest extends FormRequest
{
    use ValidatesBranding;

    public function authorize(): bool
    {
        // Machine accounts do not count as "someone has registered" — same
        // gate as RegisterRequest so first-run setup stays open until an
        // actual person creates an administrator account.
        return User::query()->where('is_system', false)->doesntExist();
    }

    /**
     * @throws AuthorizationException
     */
    protected function failedAuthorization(): void
    {
        throw new AuthorizationException(__('auth.registration_closed'));
    }
}
