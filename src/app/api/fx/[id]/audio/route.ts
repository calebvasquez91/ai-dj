import { Readable } from "node:stream";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { localFileSize, localFileStream } from "@/lib/storage";
import { parseRangeHeader } from "@/lib/range";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const fx = await prisma.fxSound.findUnique({ where: { id } });
  if (!fx || fx.userId !== session.user.id) {
    return notFound();
  }

  let size: number;
  try {
    size = await localFileSize(fx.storageKey);
  } catch {
    return notFound();
  }

  const range = parseRangeHeader(request.headers.get("range"), size);

  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  }

  if (range.kind === "none") {
    const stream = Readable.toWeb(localFileStream(fx.storageKey)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": fx.mimeType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const { start, end } = range;
  const stream = Readable.toWeb(localFileStream(fx.storageKey, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Type": fx.mimeType,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = apiHandler(handleGET);
