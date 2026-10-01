// Backend-aware upload of an FX sound's audio bytes + metadata. Mirrors
// trackUpload.ts's NEXT_PUBLIC_STORAGE_BACKEND branch exactly — see that
// file for the reasoning (4.5MB server body cap on the blob path, etc.).
import type { FxCategory, FxSound } from "@/types/music";

interface FxUploadMetadata {
  name: string;
  category: FxCategory;
  durationSec: number;
}

export async function uploadFx(file: File, metadata: FxUploadMetadata): Promise<FxSound> {
  const backend = process.env.NEXT_PUBLIC_STORAGE_BACKEND === "blob" ? "blob" : "local";

  const res = backend === "local" ? await uploadLocal(file, metadata) : await uploadToBlob(file, metadata);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `FX upload failed (${res.status})`);
  }
  return (await res.json()) as FxSound;
}

async function uploadLocal(file: File, metadata: FxUploadMetadata): Promise<Response> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", metadata.name);
  formData.append("category", metadata.category);
  formData.append("durationSec", String(metadata.durationSec));
  return fetch("/api/fx", { method: "POST", body: formData });
}

async function uploadToBlob(file: File, metadata: FxUploadMetadata): Promise<Response> {
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/fx/upload-token",
  });
  return fetch("/api/fx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: metadata.name,
      fileName: file.name,
      category: metadata.category,
      durationSec: metadata.durationSec,
      blobUrl: blob.url,
      mimeType: file.type,
    }),
  });
}
