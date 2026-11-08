import { createFileRoute } from "@tanstack/react-router";

const ENDPOINT = "https://index-translate.bilibili.com/v1/chat/completions";

export const Route = createFileRoute("/api/translate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { text?: string; to?: string };
        const text = (body.text || "").trim().slice(0, 2000);
        if (!text) return Response.json({ ok: false, error: "没有要翻译的内容" }, { status: 400 });
        const target = body.to === "en" ? "English" : "Simplified Chinese";
        try {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "Index-Translate-35B-A3B",
              temperature: 0,
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content: `Translate the following into ${target}. Output only the translation, with no explanation.\n\n${text}`,
                },
              ],
            }),
          });
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
            error?: { message?: string };
          };
          const out = data.choices?.[0]?.message?.content?.trim() || "";
          if (!res.ok || !out) {
            return Response.json({ ok: false, error: data.error?.message || `翻译失败 ${res.status}` }, { status: 502 });
          }
          return Response.json({ ok: true, text: out });
        } catch {
          return Response.json({ ok: false, error: "翻译接口连不上" }, { status: 502 });
        }
      },
    },
  },
});
