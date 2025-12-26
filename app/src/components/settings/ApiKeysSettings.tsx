import { ActionIcon, Button, PasswordInput, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { configAPI, tauriAPI } from "../../lib/tauri";

const GLOBAL_ONLY_TOOLTIP =
  "This setting can only be changed in the Default profile";

interface ApiKeyConfig {
  id: string;
  label: string;
  placeholder: string;
  storeKey: string;
  getKeyUrl: string;
}

const API_KEYS: ApiKeyConfig[] = [
  {
    id: "groq",
    label: "Groq",
    placeholder: "Enter API key",
    storeKey: "groq_api_key",
    getKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "gemini",
    label: "Google AI Studio",
    placeholder: "Enter API key",
    storeKey: "gemini_api_key",
    getKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "Enter API key",
    storeKey: "openai_api_key",
    getKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "deepgram",
    label: "Deepgram",
    placeholder: "Enter API key",
    storeKey: "deepgram_api_key",
    getKeyUrl: "https://console.deepgram.com/project",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "Enter API key",
    storeKey: "anthropic_api_key",
    getKeyUrl: "https://platform.claude.com/settings/keys",
  },
];

export const API_KEY_STORE_KEYS = API_KEYS.map((k) => k.storeKey);

function ApiKeyInput({ config }: { config: ApiKeyConfig }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [isPrefilling, setIsPrefilling] = useState(false);
  const hasHydratedRef = useRef(false);

  const { data: savedKeyValue } = useQuery({
    queryKey: ["apiKeyValue", config.storeKey],
    queryFn: () => tauriAPI.getApiKey(config.storeKey),
    staleTime: 0,
  });

  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (!savedKeyValue) return;

    // Mirror the setup guide: if a key exists, show it in the PasswordInput
    // (hidden by default), so Show/Hide reveals something useful.
    setValue(savedKeyValue);
    hasHydratedRef.current = true;
  }, [savedKeyValue]);

  // Mutation to save key
  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      await tauriAPI.setApiKey(config.storeKey, key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["apiKeyValue", config.storeKey],
      });
      queryClient.invalidateQueries({ queryKey: ["availableProviders"] });
      // Sync pipeline config when API keys change
      configAPI.syncPipelineConfig();
      // Keep the saved value in the field so the button disables when unchanged.
      setValue((prev) => prev.trim());
      hasHydratedRef.current = true;
    },
  });

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    saveKey.mutate(trimmed);
  };

  const trimmedValue = value.trim();
  const trimmedSaved = (savedKeyValue ?? "").trim();
  const isUnchanged =
    trimmedSaved.length > 0 &&
    trimmedValue.length > 0 &&
    trimmedValue === trimmedSaved;

  return (
    <div className="settings-row api-keys-row">
      <div>
        <p className="settings-label">{config.label}</p>
      </div>
      <div className="settings-row-actions">
        <Tooltip label="Get key" withArrow>
          <ActionIcon
            component="a"
            href={config.getKeyUrl}
            target="_blank"
            rel="noreferrer"
            variant="subtle"
            color="gray"
            size={36}
          >
            <LinkIcon size={16} />
          </ActionIcon>
        </Tooltip>
        <PasswordInput
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          placeholder={config.placeholder}
          size="sm"
          disabled={isPrefilling || saveKey.isPending}
          styles={{
            input: {
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              height: 36,
              width: 200,
            },
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Tooltip label="Set API key">
          <Button
            color="orange"
            size="sm"
            onClick={handleSave}
            loading={saveKey.isPending}
            disabled={!trimmedValue || saveKey.isPending || isUnchanged}
            styles={{
              root: {
                height: 36,
              },
            }}
          >
            Set
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

export function ApiKeysSettings({
  editingProfileId,
}: {
  editingProfileId?: string;
}) {
  const isProfileScope = editingProfileId && editingProfileId !== "default";

  const content = (
    <>
      {API_KEYS.map((config) => (
        <ApiKeyInput key={config.id} config={config} />
      ))}
    </>
  );

  if (isProfileScope) {
    return (
      <Tooltip label={GLOBAL_ONLY_TOOLTIP} withArrow position="top-start">
        <div style={{ opacity: 0.5, cursor: "not-allowed" }}>
          <div style={{ pointerEvents: "none" }}>{content}</div>
        </div>
      </Tooltip>
    );
  }

  return content;
}
