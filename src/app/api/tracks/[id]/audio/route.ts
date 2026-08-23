import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { localFileSize, localFileStream } from "@/lib/storage";

/** Parses a single-range `Range: bytes=start-end` header (all real <audio> seek requests use exactly one range). */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;
  const start = startStr ? Number(startStr) : Math.max(0, size - Number(endStr));
  const end = endStr && startStr ? Math.min(Number(endStr), size - 1) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0) return null;
  return { start, end };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track || track.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  let size: number;
  try {
    size = await localFileSize(track.storageKey);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const range = parseRange(request.headers.get("range"), size);

  if (!range) {
    const stream = Readable.toWeb(localFileStream(track.storageKey)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": track.mimeType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const { start, end } = range;
  const stream = Readable.toWeb(localFileStream(track.storageKey, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Type": track.mimeType,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
