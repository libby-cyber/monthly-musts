// Stores task attachments in Vercel Blob and deletes them again.
// Auth: OIDC via the connected store (BLOB_STORE_ID + VERCEL_OIDC_TOKEN,
// read automatically by the SDK), or a legacy BLOB_READ_WRITE_TOKEN.
const { put, del } = require("@vercel/blob");

const MAX_BYTES = Math.floor(4.4 * 1024 * 1024);

function storeConnected() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!storeConnected()) {
    res.status(500).json({ error: "no_store" });
    return;
  }

  // JSON body with {delete: url} removes a stored file
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && req.body.delete) {
    const url = String(req.body.delete);
    if (url.includes(".blob.vercel-storage.com/")) {
      try { await del(url); } catch (e) { console.error("blob delete failed", e); }
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
    });
    res.status(200).json({ url: blob.url, name });
  } catch (e) {
    console.error("blob upload failed", e);
    const msg = String((e && e.message) || "");
    if (/private|access/i.test(msg)) {
      res.status(500).json({ error: "private_store" });
    } else {
      res.status(500).json({ error: "upload_failed" });
    }
  }
};
