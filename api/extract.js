// Reads a photo of a to-do list with Claude and returns structured tasks.
// Requires ANTHROPIC_API_KEY set in Vercel's environment variables.
const Anthropic = require("@anthropic-ai/sdk");

const REPEATS = new Set(["none", "week-1", "week-2", "month-1", "month-3"]);

function prompt(people, today) {
  return [
    "This photo shows a to-do list (handwritten or printed). Extract every task on it.",
    "Today is " + today + ".",
    Array.isArray(people) && people.length
      ? "Known people who may be named next to items: " + people.join(", ") + "."
      : "",
    "Return ONLY a JSON object, no other text, in exactly this shape:",
    '{"tasks":[{"name":"...","importance":3,"date":"YYYY-MM-DD","repeat":"none","assignee":null,"checklist":[]}]}',
    "Rules:",
    "- importance: 3 for urgent/money/deadline items (rent, payroll, taxes), 2 for normal tasks, 1 for small errands.",
    "- date: only when a date or day is actually written; resolve relative dates using today's date; otherwise null.",
    "- repeat: only when the list says so — weekly = week-1, every 2 weeks/biweekly = week-2, monthly = month-1, quarterly = month-3; otherwise none.",
    "- assignee: exactly one of the known people, only if that name is written next to the item; otherwise null.",
    "- checklist: sub-items indented or bulleted under a task; otherwise [].",
    "- Keep names short and readable; fix obvious spelling from messy handwriting.",
  ].filter(Boolean).join("\n");
}

function clean(parsed, people) {
  const list = Array.isArray(parsed && parsed.tasks) ? parsed.tasks : [];
  return list.slice(0, 40).map(t => ({
    name: String(t.name || "").trim().slice(0, 120),
    importance: [1, 2, 3].includes(t.importance) ? t.importance : 2,
    date: typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
    repeat: REPEATS.has(t.repeat) ? t.repeat : "none",
    assignee: Array.isArray(people) && people.includes(t.assignee) ? t.assignee : null,
    checklist: Array.isArray(t.checklist)
      ? t.checklist.map(s => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 30)
      : [],
  })).filter(t => t.name);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "no_key" });
    return;
  }
  const { image, mediaType, people, today } = req.body || {};
  if (!image || typeof image !== "string" || image.length > 6_000_000) {
    res.status(400).json({ error: "no_image" });
    return;
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: typeof mediaType === "string" ? mediaType : "image/jpeg",
              data: image,
            },
          },
          { type: "text", text: prompt(people, String(today || new Date().toDateString())) },
        ],
      }],
    });
    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "refused" });
      return;
    }
    const text = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      res.status(502).json({ error: "unparseable" });
      return;
    }
    res.status(200).json({ tasks: clean(parsed, people) });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "bad_key" });
    } else if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "rate_limited" });
    } else {
      console.error("extract failed", error);
      res.status(500).json({ error: "extract_failed" });
    }
  }
};
