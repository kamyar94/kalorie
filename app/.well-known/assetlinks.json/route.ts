// GET /.well-known/assetlinks.json: Digital Asset Links for the Kal Android app (lib/android), so
// Android opens this site full screen in the app and lets the app handle its links. Built from
// ANDROID_APP_ID and ANDROID_CERT_SHA256; 404 until both are set. Public, like every Asset Links
// file (the proxy lets it through without a session).
import { assetLinks } from "@/lib/android/config";

export const dynamic = "force-dynamic";

export const GET = () => {
  const statements = assetLinks();
  if (!statements)
    return Response.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  return new Response(JSON.stringify(statements), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
};
