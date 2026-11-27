# Control Panel — Frontend

Next.js 16 (App Router, JS only) frontend for the Control Panel server-management panel. Consumes the Laravel backend API, no business logic lives here.

## Stack

Next.js 16 · Tailwind CSS v4 · shadcn/ui (Radix) · next-themes · next-intl · Zustand (where needed) · TanStack Table · react-hook-form + Zod · Axios · Sonner · Recharts · Lucide React.

## Getting started

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — start the production server
- `npm run lint` — run ESLint + project-specific checks
- `npm test` — run the test suite (Vitest + project checks)

## Structure

```
app/[locale]/
  (auth)/    unauthenticated pages (login, register, first-run wizard)
  (app)/     authenticated dashboard pages
  (admin)/   admin-only pages (role-gated)
components/  ui/ (shadcn primitives) + sections/ + forms/ + branding/
lib/         api/, auth/, schemas/, theme/, branding/
i18n/        next-intl routing config
messages/    locale dictionaries (en, es, de, fr, pt, ja, ru, hi)
```

## White-label branding

The panel supports full white-labeling through the web UI:

- **First-run wizard** (`/register`): before the first user registers, the
  registration page includes an optional branding step where you can set a
  custom name, primary colour, and upload logos.
- **Admin branding studio** (`/admin/branding`): administrators can update
  or reset branding at any time. Changes are stored in the database and
  applied instantly — no rebuild required.

The branding pipeline: `config/branding.php` defaults → DB overrides →
Central overlay → `GET /api/branding` → `mergeBranding()` → `BrandingProvider`
→ all layout and component rendering.
