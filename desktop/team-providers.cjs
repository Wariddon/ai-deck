const geminiBase = "https://generativelanguage.googleapis.com/v1beta";
const ollamaBase = "http://127.0.0.1:11434";
const modelId = /^[a-z0-9][a-z0-9:._/-]{0,159}$/iu;
const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0;

class TeamProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function responseJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The provider sent an empty response.");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 ** 2) throw new Error("The provider response exceeded the size limit.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

function teamProvidersClient({ fetcher = fetch } = {}) {
  async function request(provider, route, { key, body, signal, timeout = 10000 } = {}) {
    if (provider !== "gemini" && provider !== "ollama") throw new TeamProviderError("Choose Gemini or Ollama.", "failed");
    const gemini = provider === "gemini";
    if (gemini && !key) throw new TeamProviderError("Add a Gemini API key in Team providers.", "signIn");
    const deadline = AbortSignal.timeout(timeout);
    try {
      const response = await fetcher((gemini ? geminiBase : ollamaBase) + route, {
        redirect: "error", signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: { ...(gemini && { "x-goog-api-key": key }), ...(body && { "Content-Type": "application/json" }) },
        ...(body && { method: "POST", body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) throw new TeamProviderError(
          gemini ? "Gemini reached its usage limit. Try again later or change this member's model in Session Team."
            : "Ollama is rate-limited. Try again when its server is available.", "limited");
        if (gemini && [400, 401, 403].includes(response.status) && !body) {
          throw new TeamProviderError("Google rejected the API key or its access to Gemini.", "signIn");
        }
        if (response.status === 404 && body) throw new TeamProviderError("The selected model is unavailable. Refresh the provider’s model list.", "failed");
        throw new TeamProviderError("The provider returned HTTP " + response.status + ".", "failed");
      }
      return await responseJson(response);
    } catch (error) {
      if (signal?.aborted && signal.reason?.name !== "TimeoutError") throw new TeamProviderError("The member was stopped.", "interrupted");
      if (deadline.aborted || signal?.aborted) throw new TeamProviderError("The provider did not respond in time.", "failed");
      if (error instanceof TeamProviderError) throw error;
      throw new TeamProviderError(gemini ? "Could not reach Gemini." : "Could not reach Ollama on this PC.", "unavailable");
    }
  }

  async function list(provider, key) {
    if (provider === "ollama") {
      const data = await request(provider, "/api/tags");
      if (!Array.isArray(data?.models)) throw new TeamProviderError("Ollama did not return a model catalog.", "failed");
      return data.models.filter((model) => typeof model?.name === "string" && modelId.test(model.name) &&
        !/[:-]cloud$/iu.test(model.name) && !model.remote_host && !model.remote_model)
        .slice(0, 200).map(({ name }) => ({ value: name, label: name }));
    }
    const models = [];
    let pageToken;
    const signal = AbortSignal.timeout(12000);
    for (let page = 0; page < 4; page++) {
      const data = await request(provider, "/models?pageSize=100" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), { key, signal });
      if (!Array.isArray(data?.models)) throw new TeamProviderError("Gemini did not return a model catalog.", "failed");
      for (const row of data.models) {
        const value = typeof row?.name === "string" ? row.name.replace(/^models\//u, "") : "";
        if (modelId.test(value) && !value.includes("/") && Array.isArray(row.supportedGenerationMethods) && row.supportedGenerationMethods.includes("generateContent") &&
            /^gemini-/u.test(value) && !/image|tts|robotics|embedding|audio|live|veo|imagen/iu.test(value)) {
          models.push({ value, label: typeof row.displayName === "string" ? row.displayName.slice(0, 120) : value });
        }
      }
      pageToken = data.nextPageToken;
      if (typeof pageToken !== "string" || !pageToken) break;
    }
    return [...new Map(models.map((item) => [item.value, item])).values()];
  }

  async function run(provider, { model, prompt, key, signal, lowMemory }) {
    if (typeof model !== "string" || !modelId.test(model)) throw new TeamProviderError("Choose a valid model.", "failed");
    const gemini = provider === "gemini";
    const data = await request(provider, gemini ? "/models/" + encodeURIComponent(model) + ":generateContent" : "/api/chat", {
      key, signal, timeout: 180000,
      body: gemini ? { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } }
        : { model, messages: [{ role: "user", content: prompt }], stream: false, options: { num_predict: 4096 },
          ...(lowMemory && { keep_alive: 0 }) },
    });
    const candidate = data?.candidates?.[0];
    const finish = gemini ? candidate?.finishReason : data?.done_reason;
    if ((gemini && (finish && finish !== "STOP" || data?.promptFeedback?.blockReason)) ||
        (!gemini && (data?.done === false || finish === "length"))) {
      throw new TeamProviderError("The provider did not finish a usable report. Shorten the task or choose another model.", "failed");
    }
    const parts = candidate?.content?.parts;
    const text = gemini ? (Array.isArray(parts) ? parts.filter((part) => !part?.thought && typeof part?.text === "string").map(({ text }) => text).join("\n") : "")
      : data?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new TeamProviderError("The model returned no text. Try another model or a smaller task.", "failed");
    const input = gemini ? data.usageMetadata?.promptTokenCount : data.prompt_eval_count;
    const output = gemini ? data.usageMetadata?.candidatesTokenCount : data.eval_count;
    const reportedTotal = gemini ? data.usageMetadata?.totalTokenCount : undefined;
    const reasoning = gemini ? data.usageMetadata?.thoughtsTokenCount : undefined;
    return { text: text.slice(0, 20000), model: gemini ? data.modelVersion ?? model : data.model ?? model,
      usage: tokenCount(input) && tokenCount(output) ? {
        input, output, total: tokenCount(reportedTotal) && reportedTotal >= input + output ? reportedTotal : input + output,
        ...(tokenCount(reasoning) && { reasoning }),
      } : undefined };
  }
  return { list, run };
}

module.exports = { teamProvidersClient };
