import { IconBrandOpenai, IconCpu } from "@tabler/icons-react";
import claudeLogo from "simple-icons/icons/claude.svg?url";
import geminiLogo from "simple-icons/icons/googlegemini.svg?url";
import ollamaLogo from "simple-icons/icons/ollama.svg?url";
import { effortLabels } from "../desktop/agent-settings.mjs";

const providerLogos = { claude: claudeLogo, gemini: geminiLogo, ollama: ollamaLogo };

export function Brand({ agent, size = 32 }) {
  return agent === "codex"
    ? <IconBrandOpenai size={size} stroke={1.6} aria-hidden="true" />
    : <span className="provider-icon" data-provider={agent} style={{ width: size, height: size, maskImage: `url("${providerLogos[agent] ?? claudeLogo}")` }} aria-hidden="true" />;
}

export function AgentMark({ provider }) {
  return <span className="thread-agent-mark" data-provider={provider}>
    {provider === "codex" || Object.hasOwn(providerLogos, provider)
      ? <Brand agent={provider} size={15} /> : <IconCpu size={15} aria-hidden="true" />}
  </span>;
}

export function ModelMeta({ profile }) {
  const effort = profile?.effort;
  return <span className="thread-model-meta">
    <span title={profile?.model}>{profile?.model || "Model not recorded"}</span>
    <span>{effort ? "Effort " + (effortLabels[effort] ?? effort) : "Effort not recorded"}</span>
  </span>;
}
