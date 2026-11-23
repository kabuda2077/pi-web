import { ImportDefaultsError, readImportContextWindows, writeImportContextWindows } from "@/lib/model-import-defaults";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// The desktop fork's import defaults of the models editor: for a custom
// provider, the context window its imported models get (lib/model-import.ts).
//   GET  { contextWindows: { <provider>: <tokens> } }
//   PUT  the same object: the whole set, replacing what was stored

export function GET() {
  return Response.json({ contextWindows: readImportContextWindows() });
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    return Response.json({ contextWindows: writeImportContextWindows(body?.contextWindows) });
  } catch (error) {
    const status = error instanceof ImportDefaultsError ? 400 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
