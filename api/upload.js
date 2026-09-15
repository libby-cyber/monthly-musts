// Stores task attachments in Vercel Blob and deletes them again.
// Requires a Blob store connected to the project (BLOB_READ_WRITE_TOKEN).
const { put, del } = require("@vercel/blob");

const MAX_BYTES = Math.floor(4.4 * 1024 * 1024);

// The connect flow names the token BLOB_READ_WRITE_TOKEN by default, but a
// custom-prefixed store yields e.g. MYSTORE_READ_WRITE_TOKEN — accept any.
function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith("_READ_WRITE_TOKEN") && typeof v === "string" && v.startsWith("vercel_blob_")) return v;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const token = blobToken();
  if (!token) {
    res.status(500).json({ error: "no_store" });
    return;
  }

  // JSON body with {delete: url} removes a stored file
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && req.body.delete) {
    const url = String(req.body.delete);
    if (url.includes(".blob.vercel-storage.com/")) {
      try { await del(url, { token }); } catch (e) { console.error("blob delete failed", e); }
    }
    res.status(200).json({ ok: true });
    return;
  }

  // anything else is a raw file upload
  const body = Buffer.isBuffer(req.body) ? req.body : null;
  if (!body || !body.length) {
    res.status(400).json({ error: "no_file" });
    return;
  }
  if (body.length > MAX_BYTES) {
    res.status(413).json({ error: "too_big" });
    return;
  }
  let name = "file";
  try { name = decodeURIComponent(req.headers["x-file-name"] || "file"); } catch {}
  name = name.replace(/[^\w.\- ()]/g, "_").slice(0, 100) || "file";

  try {
    const blob = await put("attachments/" + name, body, {
      access: "public",
      addRandomSuffix: true,
      contentType: req.headers["content-type"] || "application/octet-stream",
      token,
    });
    res.status(200).json({ url: blob.url, name });
  } catch (e) {
    console.error("blob upload failed", e);
    res.status(500).json({ error: "upload_failed" });
  }
};
