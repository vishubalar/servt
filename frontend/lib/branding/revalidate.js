"use server";

import { revalidateTag } from "next/cache";

export async function revalidateBranding() {
  revalidateTag("branding", { expire: 0 });
}
