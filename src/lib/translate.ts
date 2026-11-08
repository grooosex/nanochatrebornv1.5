const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

type Job = {
  key: string;
  text: string;
  to: "zh" | "en";
  resolve: (text: string) => void;
  reject: (err: Error) => void;
};

const pending: Job[] = [];
let active = 0;

function pump() {
  while (active < 3 && pending.length) {
    const job = pending.shift();
    if (!job) return;
    active += 1;
    void fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: job.text, to: job.to }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
        if (!res.ok || !data.ok || !data.text) throw new Error(data.error || "翻译失败");
        cache.set(job.key, data.text);
        job.resolve(data.text);
      })
      .catch((err: unknown) => {
        job.reject(err instanceof Error ? err : new Error("翻译失败"));
      })
      .finally(() => {
        active -= 1;
        inflight.delete(job.key);
        pump();
      });
  }
}

export function translateText(text: string, to: "zh" | "en", priority = false) {
  const key = `${to}\n${text.trim()}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const existing = inflight.get(key);
  if (existing) {
    if (priority) {
      const at = pending.findIndex((job) => job.key === key);
      if (at > 0) pending.unshift(pending.splice(at, 1)[0]!);
    }
    return existing;
  }
  const promise = new Promise<string>((resolve, reject) => {
    const job: Job = { key, text: text.trim(), to, resolve, reject };
    if (priority) pending.unshift(job);
    else pending.push(job);
    pump();
  });
  inflight.set(key, promise);
  return promise;
}
