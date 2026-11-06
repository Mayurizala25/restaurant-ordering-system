import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "product-images";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: "jpeg" }],
  ["image/png", { extension: "png", signature: "png" }],
  ["image/webp", { extension: "webp", signature: "webp" }],
  ["image/avif", { extension: "avif", signature: "avif" }],
]);

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function getConfiguration() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return null;
  }
  try {
    const url = new URL(supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return { url, serviceRoleKey, restaurantId };
  } catch {
    return null;
  }
}

async function authorize(request: Request): Promise<Response | null> {
  const cookieStore = await cookies();
  if (
    !(await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    ))
  ) {
    return jsonError("Admin authentication is required.", 401);
  }

  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host") ?? requestUrl.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim();
  const requestProtocol = forwardedProtocol
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  try {
    const expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
    if (request.headers.get("origin") !== expectedOrigin) {
      return jsonError("Cross-origin image uploads are not allowed.", 403);
    }
  } catch {
    return jsonError("Image upload origin could not be verified.", 403);
  }
  return null;
}

async function readBoundedBody(request: Request): Promise<ArrayBuffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new ArrayBuffer(size);
  const bodyBytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function matchesImageSignature(bytes: Uint8Array, signature: string): boolean {
  if (signature === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (signature === "png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (signature === "webp") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (bytes.length < 16 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") {
    return false;
  }
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    const brand = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

export async function POST(request: Request) {
  const authorizationError = await authorize(request);
  if (authorizationError) return authorizationError;

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "multipart/form-data"
  ) {
    return jsonError("Send the menu item image as multipart form data.", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Images must be 5 MiB or smaller.", 413);
  }
  let body: ArrayBuffer | null;
  try {
    body = await readBoundedBody(request);
  } catch {
    return jsonError("The uploaded image could not be read.", 400);
  }
  if (!body) return jsonError("Images must be 5 MiB or smaller.", 413);

  let file: unknown;
  try {
    const formData = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    }).formData();
    if (!("get" in formData) || typeof formData.get !== "function") {
      return jsonError("The uploaded image form could not be read.", 400);
    }
    file = formData.get("image");
  } catch {
    return jsonError("The uploaded image form could not be read.", 400);
  }
  if (
    typeof File === "undefined" ||
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > MAX_FILE_BYTES
  ) {
    return jsonError("Choose an image between 1 byte and 5 MiB.", 413);
  }
  const imageType = IMAGE_TYPES.get(file.type);
  if (!imageType) {
    return jsonError("Use a JPEG, PNG, WebP, or AVIF image.", 415);
  }

  let imageBytes: ArrayBuffer;
  try {
    imageBytes = await file.arrayBuffer();
  } catch {
    return jsonError("The uploaded image could not be read.", 400);
  }
  if (
    imageBytes.byteLength !== file.size ||
    !matchesImageSignature(new Uint8Array(imageBytes), imageType.signature)
  ) {
    return jsonError("The image contents do not match the selected image type.", 415);
  }

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Supabase image storage is not configured securely.", 503);
  }
  const objectPath = `${configuration.restaurantId}/menu-items/${randomUUID()}.${imageType.extension}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${BUCKET}/${objectPath}`,
    configuration.url,
  );
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Authorization: `Bearer ${configuration.serviceRoleKey}`,
        "Content-Type": file.type,
        "cache-control": "31536000",
        "x-upsert": "false",
      },
      body: imageBytes,
    });
  } catch {
    return jsonError("Could not upload the image to Supabase Storage.", 502);
  }
  if (!response.ok) {
    return jsonError("Supabase Storage rejected the image upload.", 502);
  }

  const publicUrl = new URL(
    `/storage/v1/object/public/${BUCKET}/${objectPath}`,
    configuration.url,
  ).toString();
  return Response.json(
    { imageUrl: publicUrl },
    { headers: noStoreHeaders },
  );
}
