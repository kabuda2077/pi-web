import { allowFileRoot } from "@/lib/allowed-roots";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSessionInfos } from "@/lib/rpc-manager";
import { listSessionSummaries } from "@/lib/session-reader";
import { tempChatPathKey } from "@/lib/temp-chat-path";
import { readTempChats, releaseTempChat, reserveTempChat, setTempChatRoot, TempChatRootError } from "@/lib/temp-chats";

export const dynamic = "force-dynamic";

// The desktop fork's General chats: chats that belong to no project, each in a
// folder of its own under one root (lib/temp-chats.ts).
//   GET     the root and every folder handed out so far; creates nothing
//   POST    ?holder= the folder for the chat that window or tab starts next (reserveTempChat)
//   DELETE  ?holder= a page that goes away gives its folder back
//   PUT     { root } where new chats get their folders from now on

/** A window's or a tab's name for itself: any short string. */
function holderOf(request: Request): string | undefined {
  const holder = new URL(request.url).searchParams.get("holder");
  return holder && holder.length <= 100 ? holder : undefined;
}

function failure(error: unknown) {
  const status = error instanceof TempChatRootError ? 400 : 500;
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export function GET() {
  try {
    return Response.json(readTempChats());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    // A session on file or in memory (one a composer started and sent nothing to yet) has its folder.
    const sessions = [...await listSessionSummaries(), ...getRpcSessionInfos({ includeTransient: true })];
    const used = new Set(sessions.map((session) => tempChatPathKey(session.cwd)));
    const chat = await reserveTempChat((cwd) => used.has(tempChatPathKey(cwd)), holderOf(request));
    // The same transient grant as selecting a cwd: the composer lists models
    // and uploads attachments there before a session exists. Choosing a parent
    // folder grants nothing.
    allowFileRoot(chat.cwd);
    return Response.json(chat);
  } catch (error) {
    return failure(error);
  }
}

export function DELETE(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  releaseTempChat({ holder: holderOf(request), cwd: new URL(request.url).searchParams.get("cwd") });
  return Response.json({ released: true });
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    return Response.json(await setTempChatRoot(body?.root));
  } catch (error) {
    return failure(error);
  }
}
