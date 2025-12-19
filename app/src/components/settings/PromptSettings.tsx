import {
  Accordion,
  ActionIcon,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Slider,
  Switch,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Plus, Trash2 } from "lucide-react";
import {
  useDefaultSections,
  useSettings,
  useAvailableProviders,
  useUpdateCleanupPromptSections,
  useUpdateLLMModel,
  useUpdateLLMProvider,
  useUpdateRewriteProgramPromptProfiles,
  useUpdateRewriteLlmEnabled,
  useUpdateSTTModel,
  useUpdateSTTProvider,
  useUpdateSTTTimeout,
} from "../../lib/queries";
import {
  type CleanupPromptSections,
  type OpenWindowInfo,
  type RewriteProgramPromptProfile,
  tauriAPI,
} from "../../lib/tauri";
import { PromptSectionEditor } from "./PromptSectionEditor";

const DEFAULT_SECTIONS: CleanupPromptSections = {
  main: { enabled: true, content: null },
  advanced: { enabled: true, content: null },
  dictionary: { enabled: false, content: null },
};

const DEFAULT_STT_TIMEOUT = 0.8;

// Model options for each STT provider
const STT_MODELS: Record<string, { value: string; label: string }[]> = {
  groq: [
    { value: "whisper-large-v3", label: "Whisper Large V3" },
    { value: "whisper-large-v3-turbo", label: "Whisper Large V3 Turbo" },
  ],
  openai: [
    { value: "gpt-4o-audio-preview", label: "GPT-4o Audio Preview" },
    { value: "gpt-4o-mini-audio-preview", label: "GPT-4o Mini Audio Preview" },
    { value: "whisper-1", label: "Whisper 1 (Legacy)" },
  ],
  deepgram: [
    { value: "nova-2", label: "Nova 2" },
    { value: "nova", label: "Nova" },
    { value: "enhanced", label: "Enhanced" },
    { value: "base", label: "Base" },
  ],
  whisper: [],
};

// Model options for each LLM provider
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  anthropic: [
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-opus-latest", label: "Claude 3 Opus" },
  ],
  ollama: [],
};

type SectionKey = "main" | "advanced" | "dictionary";

interface LocalSectionState {
  enabled: boolean;
  content: string;
}

interface LocalSections {
  main: LocalSectionState;
  advanced: LocalSectionState;
  dictionary: LocalSectionState;
}

function createId(): string {
  // `crypto.randomUUID()` is available in modern browsers; keep a fallback for safety.
  // This only needs to be unique enough for local settings.
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

export function PromptSettings() {
  const { data: settings, isLoading: isLoadingSettings } = useSettings();
  const { data: defaultSections, isLoading: isLoadingDefaultSections } =
    useDefaultSections();
  const { data: availableProviders, isLoading: isLoadingProviders } =
    useAvailableProviders();
  const updateCleanupPromptSections = useUpdateCleanupPromptSections();
  const updateRewriteLlmEnabled = useUpdateRewriteLlmEnabled();
  const updateRewriteProgramPromptProfiles =
    useUpdateRewriteProgramPromptProfiles();

  // Default profile (global) provider settings
  const updateSTTProvider = useUpdateSTTProvider();
  const updateSTTModel = useUpdateSTTModel();
  const updateLLMProvider = useUpdateLLMProvider();
  const updateLLMModel = useUpdateLLMModel();
  const updateSTTTimeout = useUpdateSTTTimeout();

  const [activeProfileId, setActiveProfileId] = useState<string>("default");

  const profiles: RewriteProgramPromptProfile[] =
    settings?.rewrite_program_prompt_profiles ?? [];
  const [pendingNewProfile, setPendingNewProfile] =
    useState<RewriteProgramPromptProfile | null>(null);
  const uiProfiles = useMemo(() => {
    if (!pendingNewProfile) return profiles;
    if (profiles.some((p) => p.id === pendingNewProfile.id)) return profiles;
    return [...profiles, pendingNewProfile];
  }, [profiles, pendingNewProfile]);

  const activeProfile =
    activeProfileId === "default"
      ? null
      : uiProfiles.find((p) => p.id === activeProfileId) ?? null;

  const defaultRewriteEnabled = settings?.rewrite_llm_enabled ?? false;

  const [localProfileName, setLocalProfileName] = useState<string>("");
  const [localProfilePaths, setLocalProfilePaths] = useState<string[]>([]);
  const [localProfileSttProvider, setLocalProfileSttProvider] = useState<
    string | null
  >(null);
  const [localProfileSttModel, setLocalProfileSttModel] = useState<
    string | null
  >(null);
  const [localProfileLlmProvider, setLocalProfileLlmProvider] = useState<
    string | null
  >(null);
  const [localProfileLlmModel, setLocalProfileLlmModel] = useState<
    string | null
  >(null);
  const [localProfileRewriteEnabled, setLocalProfileRewriteEnabled] =
    useState<boolean>(false);
  const [localProfileSttTimeout, setLocalProfileSttTimeout] =
    useState<number>(DEFAULT_STT_TIMEOUT);

  const [windowPickerOpen, setWindowPickerOpen] = useState(false);
  const [windowPickerDropdownOpened, setWindowPickerDropdownOpened] =
    useState(false);
  const [openWindows, setOpenWindows] = useState<OpenWindowInfo[]>([]);
  const [isLoadingWindows, setIsLoadingWindows] = useState(false);

  const windowPickerOptions = useMemo(() => {
    // Mantine Select requires unique `value`s. Many apps (Chrome, VS Code, etc.)
    // can have multiple windows with the same executable path, so we collapse
    // those into a single option.
    const byPath = new Map<string, OpenWindowInfo>();
    for (const w of openWindows) {
      if (!byPath.has(w.process_path)) {
        byPath.set(w.process_path, w);
      }
    }

    return Array.from(byPath.values()).map((w) => ({
      value: w.process_path,
      label: `${w.title} — ${w.process_path}`,
    }));
  }, [openWindows]);

  // NOTE: Settings tabs unmount when switching (keepMounted=false). If we render
  // switches immediately, they first render with placeholder values then “jump”
  // once settings load. We avoid that by showing a loader until we have settings
  // + defaults and local state is initialized.
  const [localSections, setLocalSections] = useState<LocalSections | null>(
    null
  );

  useEffect(() => {
    if (settings !== undefined && defaultSections !== undefined) {
      // Ensure the active tab always exists.
      if (
        activeProfileId !== "default" &&
        !uiProfiles.some((p) => p.id === activeProfileId)
      ) {
        setActiveProfileId("default");
        return;
      }

      const sections =
        activeProfileId === "default"
          ? settings.cleanup_prompt_sections ?? DEFAULT_SECTIONS
          : uiProfiles.find((p) => p.id === activeProfileId)
              ?.cleanup_prompt_sections ?? DEFAULT_SECTIONS;

      setLocalSections({
        main: {
          enabled: sections.main.enabled,
          content: sections.main.content ?? defaultSections.main,
        },
        advanced: {
          enabled: sections.advanced.enabled,
          content: sections.advanced.content ?? defaultSections.advanced,
        },
        dictionary: {
          enabled: sections.dictionary.enabled,
          content: sections.dictionary.content ?? defaultSections.dictionary,
        },
      });
    }
  }, [settings, defaultSections, activeProfileId, uiProfiles]);

  // When the persisted settings include the newly-created profile, drop the optimistic copy.
  useEffect(() => {
    if (!pendingNewProfile) return;
    if (profiles.some((p) => p.id === pendingNewProfile.id)) {
      setPendingNewProfile(null);
    }
  }, [profiles, pendingNewProfile]);

  useEffect(() => {
    if (activeProfile) {
      setLocalProfileName(activeProfile.name);
      setLocalProfilePaths(activeProfile.program_paths ?? []);
      setLocalProfileSttProvider(activeProfile.stt_provider ?? null);
      setLocalProfileSttModel(activeProfile.stt_model ?? null);
      setLocalProfileLlmProvider(activeProfile.llm_provider ?? null);
      setLocalProfileLlmModel(activeProfile.llm_model ?? null);
      setLocalProfileRewriteEnabled(
        activeProfile.rewrite_llm_enabled ?? defaultRewriteEnabled
      );
      setLocalProfileSttTimeout(
        activeProfile.stt_timeout_seconds ??
          settings?.stt_timeout_seconds ??
          DEFAULT_STT_TIMEOUT
      );
    } else {
      setLocalProfileName("");
      setLocalProfilePaths([]);
      setLocalProfileSttProvider(null);
      setLocalProfileSttModel(null);
      setLocalProfileLlmProvider(null);
      setLocalProfileLlmModel(null);
      setLocalProfileRewriteEnabled(defaultRewriteEnabled);
      setLocalProfileSttTimeout(
        settings?.stt_timeout_seconds ?? DEFAULT_STT_TIMEOUT
      );
    }
  }, [
    activeProfileId,
    activeProfile,
    settings?.stt_timeout_seconds,
    defaultRewriteEnabled,
  ]);

  const isLoading =
    isLoadingSettings ||
    isLoadingDefaultSections ||
    isLoadingProviders ||
    settings === undefined ||
    defaultSections === undefined ||
    localSections === null;

  // One-time migration: ensure every profile has its own rewrite enable flag.
  // This prevents the Default toggle from affecting other profiles.
  const didMigrateProfileRewriteEnabled = useRef(false);
  useEffect(() => {
    if (didMigrateProfileRewriteEnabled.current) return;
    if (!settings) return;
    if (profiles.length === 0) return;

    const needsMigration = profiles.some(
      (p) => typeof p.rewrite_llm_enabled !== "boolean"
    );
    if (!needsMigration) {
      didMigrateProfileRewriteEnabled.current = true;
      return;
    }

    didMigrateProfileRewriteEnabled.current = true;

    const migrated = profiles.map((p) => {
      const current = p.rewrite_llm_enabled;
      if (typeof current === "boolean") return p;
      return { ...p, rewrite_llm_enabled: defaultRewriteEnabled };
    });

    updateRewriteProgramPromptProfiles.mutate(migrated, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  }, [
    settings,
    profiles,
    defaultRewriteEnabled,
    updateRewriteProgramPromptProfiles,
  ]);

  // Provider dropdown options
  const sttCloudProviders =
    availableProviders?.stt
      .filter((p) => !p.is_local)
      .map((p) => ({ value: p.value, label: p.label })) ?? [];
  const sttLocalProviders =
    availableProviders?.stt
      .filter((p) => p.is_local)
      .map((p) => ({ value: p.value, label: p.label })) ?? [];
  const sttProviderOptions = [
    { group: "Cloud", items: sttCloudProviders },
    { group: "Local", items: sttLocalProviders },
  ];

  const llmCloudProviders =
    availableProviders?.llm
      .filter((p) => !p.is_local)
      .map((p) => ({ value: p.value, label: p.label })) ?? [];
  const llmLocalProviders =
    availableProviders?.llm
      .filter((p) => p.is_local)
      .map((p) => ({ value: p.value, label: p.label })) ?? [];
  const llmProviderOptions = [
    { group: "Cloud", items: llmCloudProviders },
    { group: "Local", items: llmLocalProviders },
  ];

  const effectiveSttProvider =
    activeProfileId === "default"
      ? settings?.stt_provider ?? null
      : localProfileSttProvider ?? settings?.stt_provider ?? null;
  const effectiveLlmProvider =
    activeProfileId === "default"
      ? settings?.llm_provider ?? null
      : localProfileLlmProvider ?? settings?.llm_provider ?? null;

  const sttModelOptions = effectiveSttProvider
    ? STT_MODELS[effectiveSttProvider] ?? []
    : [];
  const llmModelOptions = effectiveLlmProvider
    ? LLM_MODELS[effectiveLlmProvider] ?? []
    : [];

  const storedSections: CleanupPromptSections | null | undefined =
    activeProfileId === "default"
      ? settings?.cleanup_prompt_sections
      : activeProfile?.cleanup_prompt_sections;

  const hasCustomContent = {
    main: Boolean(storedSections?.main?.content),
    advanced: Boolean(storedSections?.advanced?.content),
    dictionary: Boolean(storedSections?.dictionary?.content),
  };

  const buildSections = (overrides?: {
    key: SectionKey;
    enabled?: boolean;
    content?: string | null;
  }): CleanupPromptSections => {
    if (localSections === null) {
      return DEFAULT_SECTIONS;
    }

    const getContent = (key: SectionKey): string | null => {
      const content =
        overrides?.key === key && overrides.content !== undefined
          ? overrides.content
          : localSections[key].content;

      // Return null if content matches default (to use server default)
      if (content === defaultSections?.[key]) {
        return null;
      }
      return content || null;
    };

    const getEnabled = (key: SectionKey): boolean => {
      return overrides?.key === key && overrides.enabled !== undefined
        ? overrides.enabled
        : localSections[key].enabled;
    };

    return {
      main: { enabled: getEnabled("main"), content: getContent("main") },
      advanced: {
        enabled: getEnabled("advanced"),
        content: getContent("advanced"),
      },
      dictionary: {
        enabled: getEnabled("dictionary"),
        content: getContent("dictionary"),
      },
    };
  };

  const saveAllSections = (sections: CleanupPromptSections) => {
    if (activeProfileId === "default") {
      updateCleanupPromptSections.mutate(sections, {
        onSuccess: () => {
          tauriAPI.emitSettingsChanged();
        },
      });
      return;
    }

    const nextProfiles = uiProfiles.map((p) =>
      p.id === activeProfileId ? { ...p, cleanup_prompt_sections: sections } : p
    );
    updateRewriteProgramPromptProfiles.mutate(nextProfiles, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const saveProfileMetadata = (next: Partial<RewriteProgramPromptProfile>) => {
    if (!activeProfile) return;

    const updated = uiProfiles.map((p) =>
      p.id === activeProfile.id ? { ...p, ...next } : p
    );

    updateRewriteProgramPromptProfiles.mutate(updated, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const addProfile = () => {
    const baseSections = settings?.cleanup_prompt_sections ?? DEFAULT_SECTIONS;
    const newProfile: RewriteProgramPromptProfile = {
      id: createId(),
      name: "New Profile",
      program_paths: [],
      cleanup_prompt_sections: JSON.parse(
        JSON.stringify(baseSections)
      ) as CleanupPromptSections,
      stt_provider: settings?.stt_provider ?? null,
      stt_model: settings?.stt_model ?? null,
      stt_timeout_seconds: settings?.stt_timeout_seconds ?? DEFAULT_STT_TIMEOUT,
      llm_provider: settings?.llm_provider ?? null,
      llm_model: settings?.llm_model ?? null,
      rewrite_llm_enabled: defaultRewriteEnabled,
    };

    // Optimistically show the new tab immediately.
    setPendingNewProfile(newProfile);
    setActiveProfileId(newProfile.id);
    setLocalProfileName(newProfile.name);
    setLocalProfilePaths([]);
    setLocalProfileSttProvider(newProfile.stt_provider ?? null);
    setLocalProfileSttModel(newProfile.stt_model ?? null);
    setLocalProfileLlmProvider(newProfile.llm_provider ?? null);
    setLocalProfileLlmModel(newProfile.llm_model ?? null);
    setLocalProfileRewriteEnabled(defaultRewriteEnabled);
    setLocalProfileSttTimeout(
      newProfile.stt_timeout_seconds ?? DEFAULT_STT_TIMEOUT
    );

    const next = [...profiles, newProfile];
    updateRewriteProgramPromptProfiles.mutate(next, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
      onError: () => {
        // If persisting fails, revert the optimistic tab.
        setPendingNewProfile(null);
        setActiveProfileId("default");
      },
    });
  };

  const updateProgramPathAtIndex = (idx: number, nextValue: string) => {
    if (!activeProfile) return;

    const next = [...localProfilePaths];
    next[idx] = nextValue;
    setLocalProfilePaths(next);
  };

  const persistProgramPaths = (paths: string[]) => {
    if (!activeProfile) return;
    saveProfileMetadata({ program_paths: paths });
  };

  const removeProgramPathAtIndex = (idx: number) => {
    if (!activeProfile) return;
    const next = localProfilePaths.filter((_, i) => i !== idx);
    setLocalProfilePaths(next);
    persistProgramPaths(next);
  };

  const addEmptyProgramPath = () => {
    if (!activeProfile) return;
    const next = [...localProfilePaths, ""];
    setLocalProfilePaths(next);
    // Don't persist until blur; avoids saving lots of empty strings.
  };

  const deleteActiveProfile = () => {
    if (activeProfileId === "default") return;

    // If the active profile is still optimistic (not yet in persisted settings), just cancel it.
    if (
      pendingNewProfile &&
      activeProfileId === pendingNewProfile.id &&
      !profiles.some((p) => p.id === pendingNewProfile.id)
    ) {
      setPendingNewProfile(null);
      setActiveProfileId("default");
      return;
    }

    const profile = profiles.find((p) => p.id === activeProfileId);
    const name = profile?.name?.trim() || "this profile";

    // Keep it simple: confirm before deleting.
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) {
      return;
    }

    const next = profiles.filter((p) => p.id !== activeProfileId);
    updateRewriteProgramPromptProfiles.mutate(next, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
        setActiveProfileId("default");
      },
    });
  };

  const openWindowPicker = async () => {
    setWindowPickerOpen(true);
    setWindowPickerDropdownOpened(true);
    setIsLoadingWindows(true);
    try {
      const windows = await tauriAPI.listOpenWindows();
      setOpenWindows(windows);
    } finally {
      setIsLoadingWindows(false);
    }
  };

  const addProgramPathFromPicker = (value: string) => {
    if (!activeProfile) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    const existing = new Set(
      localProfilePaths.map((p) => p.trim()).filter(Boolean)
    );
    if (existing.has(trimmed)) {
      setWindowPickerOpen(false);
      return;
    }

    // Prefer filling the first empty row rather than always appending.
    const firstEmptyIndex = localProfilePaths.findIndex(
      (p) => p.trim().length === 0
    );

    const nextLocal = [...localProfilePaths];
    if (firstEmptyIndex >= 0) {
      nextLocal[firstEmptyIndex] = trimmed;
    } else {
      nextLocal.push(trimmed);
    }

    // Persist a clean list (trim, remove empties, de-dupe while preserving order).
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const p of nextLocal) {
      const v = p.trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      deduped.push(v);
    }

    setLocalProfilePaths(deduped);
    persistProgramPaths(deduped);
    setWindowPickerOpen(false);
  };

  const handleToggle = (key: SectionKey, checked: boolean) => {
    setLocalSections((prev) => {
      if (prev === null) return prev;
      return { ...prev, [key]: { ...prev[key], enabled: checked } };
    });
    saveAllSections(buildSections({ key, enabled: checked }));
  };

  const handleSave = (key: SectionKey, content: string) => {
    setLocalSections((prev) => {
      if (prev === null) return prev;
      return { ...prev, [key]: { ...prev[key], content } };
    });
    saveAllSections(buildSections({ key, content }));
  };

  const handleReset = (key: SectionKey) => {
    const defaultContent = defaultSections?.[key] ?? "";
    setLocalSections((prev) => {
      if (prev === null) return prev;
      return { ...prev, [key]: { ...prev[key], content: defaultContent } };
    });
    saveAllSections(buildSections({ key, content: null }));
  };

  const handleDefaultSTTProviderChange = (value: string | null) => {
    if (!value) return;
    updateSTTProvider.mutate(value, {
      onSuccess: () => {
        const models = STT_MODELS[value];
        const firstModel = models?.[0];
        if (firstModel) {
          updateSTTModel.mutate(firstModel.value);
        }
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const handleDefaultSTTModelChange = (value: string | null) => {
    if (!value) return;
    updateSTTModel.mutate(value, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const handleDefaultLLMProviderChange = (value: string | null) => {
    if (!value) return;
    updateLLMProvider.mutate(value, {
      onSuccess: () => {
        const models = LLM_MODELS[value];
        const firstModel = models?.[0];
        if (firstModel) {
          updateLLMModel.mutate(firstModel.value);
        }
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const handleDefaultLLMModelChange = (value: string | null) => {
    if (!value) return;
    updateLLMModel.mutate(value, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  const handleDefaultSTTTimeoutChange = (value: number) => {
    updateSTTTimeout.mutate(value, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
  };

  return (
    <>
      <Tabs
        value={activeProfileId}
        onChange={(v) => setActiveProfileId(v ?? "default")}
        keepMounted={false}
      >
        <Group justify="space-between" align="center" mb="md" wrap="nowrap">
          <Tabs.List>
            <Tabs.Tab value="default">Default</Tabs.Tab>
            {uiProfiles.map((p) => (
              <Tabs.Tab key={p.id} value={p.id}>
                {p.name.trim() || "(Unnamed)"}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Button
            size="xs"
            variant="light"
            color="gray"
            onClick={addProfile}
            disabled={isLoading}
          >
            Add profile
          </Button>
        </Group>

        <Tabs.Panel value="default">
          {isLoading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <Loader size="sm" color="gray" />
            </div>
          ) : (
            <>
              {/* Provider settings for Default (global baseline) */}
              <Divider my="md" label="Speech-to-text" labelPosition="left" />
              <div className="settings-row">
                <div>
                  <p className="settings-label">Speech-to-Text Provider</p>
                  <p className="settings-description">
                    Service for transcribing audio
                  </p>
                </div>
                <Select
                  data={sttProviderOptions}
                  value={settings?.stt_provider ?? null}
                  onChange={handleDefaultSTTProviderChange}
                  placeholder="Select provider"
                  withCheckIcon={false}
                  disabled={
                    sttCloudProviders.length === 0 &&
                    sttLocalProviders.length === 0
                  }
                  styles={{
                    input: {
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      minWidth: 200,
                    },
                  }}
                />
              </div>

              {sttModelOptions.length > 0 && (
                <div className="settings-row">
                  <div>
                    <p className="settings-label">STT Model</p>
                    <p className="settings-description">
                      Model to use for transcription
                    </p>
                  </div>
                  <Select
                    data={sttModelOptions}
                    value={
                      settings?.stt_model ?? sttModelOptions[0]?.value ?? null
                    }
                    onChange={handleDefaultSTTModelChange}
                    placeholder="Select model"
                    withCheckIcon={false}
                    styles={{
                      input: {
                        backgroundColor: "var(--bg-elevated)",
                        borderColor: "var(--border-default)",
                        color: "var(--text-primary)",
                        minWidth: 200,
                      },
                    }}
                  />
                </div>
              )}

              <div className="settings-row">
                <div style={{ flex: 1 }}>
                  <p className="settings-label">STT Timeout</p>
                  <p className="settings-description">
                    Increase if nothing is getting transcribed
                  </p>
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Slider
                      value={localProfileSttTimeout}
                      onChange={setLocalProfileSttTimeout}
                      onChangeEnd={(v) => {
                        setLocalProfileSttTimeout(v);
                        handleDefaultSTTTimeoutChange(v);
                      }}
                      min={0.5}
                      max={3.0}
                      step={0.1}
                      marks={[
                        { value: 0.5, label: "0.5s" },
                        { value: 3.0, label: "3.0s" },
                      ]}
                      styles={{
                        root: { flex: 1 },
                        track: { backgroundColor: "var(--bg-elevated)" },
                        bar: { backgroundColor: "var(--accent-primary)" },
                        thumb: { borderColor: "var(--accent-primary)" },
                        markLabel: {
                          color: "var(--text-secondary)",
                          fontSize: 10,
                        },
                      }}
                    />
                    <Text size="xs" c="dimmed" style={{ minWidth: 32 }}>
                      {localProfileSttTimeout.toFixed(1)}s
                    </Text>
                  </div>
                </div>
              </div>

              <Divider my="md" label="Language model" labelPosition="left" />

              <div className="settings-row">
                <div>
                  <p className="settings-label">Rewrite Transcription</p>
                  <p className="settings-description">
                    Enable or disable rewriting the transcription with an LLM
                  </p>
                </div>
                <Switch
                  checked={defaultRewriteEnabled}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked;
                    updateRewriteLlmEnabled.mutate(enabled, {
                      onSuccess: () => {
                        tauriAPI.emitSettingsChanged();
                      },
                    });
                  }}
                  color="gray"
                  size="md"
                />
              </div>

              <div className="settings-row">
                <div>
                  <p className="settings-label">Language Model Provider</p>
                  <p className="settings-description">
                    AI service for text formatting
                  </p>
                </div>
                <Select
                  data={llmProviderOptions}
                  value={settings?.llm_provider ?? null}
                  onChange={handleDefaultLLMProviderChange}
                  placeholder="Select provider"
                  withCheckIcon={false}
                  disabled={
                    llmCloudProviders.length === 0 &&
                    llmLocalProviders.length === 0
                  }
                  styles={{
                    input: {
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      minWidth: 200,
                    },
                  }}
                />
              </div>

              {llmModelOptions.length > 0 && (
                <div className="settings-row">
                  <div>
                    <p className="settings-label">Rewrite LLM Model</p>
                    <p className="settings-description">
                      LLM Model used to rewrite the transcription.
                    </p>
                  </div>
                  <Select
                    data={llmModelOptions}
                    value={
                      settings?.llm_model ?? llmModelOptions[0]?.value ?? null
                    }
                    onChange={handleDefaultLLMModelChange}
                    placeholder="Select model"
                    withCheckIcon={false}
                    styles={{
                      input: {
                        backgroundColor: "var(--bg-elevated)",
                        borderColor: "var(--border-default)",
                        color: "var(--text-primary)",
                        minWidth: 200,
                      },
                    }}
                  />
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <Accordion variant="separated" radius="md">
                  <PromptSectionEditor
                    sectionKey={`${activeProfileId}-main-prompt`}
                    title="Core Formatting Rules"
                    description="Filler word removal, punctuation, capitalization"
                    enabled={true}
                    hideToggle={true}
                    initialContent={localSections!.main.content}
                    defaultContent={defaultSections?.main ?? ""}
                    hasCustom={hasCustomContent.main}
                    onToggle={() => {}}
                    onSave={(content) => handleSave("main", content)}
                    onReset={() => handleReset("main")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />

                  <PromptSectionEditor
                    sectionKey={`${activeProfileId}-advanced-prompt`}
                    title="Advanced Features"
                    description='Backtrack corrections ("scratch that") and list formatting'
                    enabled={localSections!.advanced.enabled}
                    initialContent={localSections!.advanced.content}
                    defaultContent={defaultSections?.advanced ?? ""}
                    hasCustom={hasCustomContent.advanced}
                    onToggle={(checked) => handleToggle("advanced", checked)}
                    onSave={(content) => handleSave("advanced", content)}
                    onReset={() => handleReset("advanced")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />

                  <PromptSectionEditor
                    sectionKey={`${activeProfileId}-dictionary-prompt`}
                    title="Personal Dictionary"
                    description="Custom word mappings for technical terms"
                    enabled={localSections!.dictionary.enabled}
                    initialContent={localSections!.dictionary.content}
                    defaultContent={defaultSections?.dictionary ?? ""}
                    hasCustom={hasCustomContent.dictionary}
                    onToggle={(checked) => handleToggle("dictionary", checked)}
                    onSave={(content) => handleSave("dictionary", content)}
                    onReset={() => handleReset("dictionary")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />
                </Accordion>
              </div>
            </>
          )}
        </Tabs.Panel>

        {uiProfiles.map((p) => (
          <Tabs.Panel key={p.id} value={p.id}>
            <div style={{ marginBottom: 16 }}>
              <TextInput
                label="Name"
                placeholder="e.g. VS Code"
                value={localProfileName}
                onChange={(e) => setLocalProfileName(e.currentTarget.value)}
                onBlur={() => {
                  if (!activeProfile) return;
                  if (localProfileName !== activeProfile.name) {
                    saveProfileMetadata({ name: localProfileName });
                  }
                }}
                styles={{ label: { fontSize: 12 } }}
              />

              <Group justify="space-between" align="center" mt="sm" mb={6}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Programs</div>
                <Group gap={8}>
                  <Tooltip
                    label="Pick from currently open apps"
                    withArrow
                    position="bottom"
                  >
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={openWindowPicker}
                      aria-label="Pick from open programs"
                    >
                      <Crosshair size={16} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    label="Add a program path"
                    withArrow
                    position="bottom"
                  >
                    <ActionIcon
                      variant="light"
                      color="gray"
                      onClick={addEmptyProgramPath}
                      aria-label="Add program"
                      disabled={
                        isLoading ||
                        updateRewriteProgramPromptProfiles.isPending
                      }
                    >
                      <Plus size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              {localProfilePaths.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.7, paddingBottom: 8 }}>
                  No programs yet. Add one to apply this profile automatically.
                </div>
              ) : null}

              {localProfilePaths.map((path, idx) => (
                <Group key={`${p.id}-path-${idx}`} mt={6} wrap="nowrap">
                  <TextInput
                    placeholder="C:\\Program Files\\...\\app.exe"
                    value={path}
                    onChange={(e) =>
                      updateProgramPathAtIndex(idx, e.currentTarget.value)
                    }
                    onBlur={() => {
                      const trimmed = localProfilePaths.map((p) => p.trim());
                      const filtered = trimmed.filter((p) => p.length > 0);

                      // If we removed empties or changed values, persist.
                      // Also de-dupe while preserving order.
                      const deduped: string[] = [];
                      const seen = new Set<string>();
                      for (const p of filtered) {
                        if (!seen.has(p)) {
                          seen.add(p);
                          deduped.push(p);
                        }
                      }

                      setLocalProfilePaths(deduped);
                      if (!activeProfile) return;
                      if (
                        JSON.stringify(deduped) !==
                        JSON.stringify(activeProfile.program_paths ?? [])
                      ) {
                        persistProgramPaths(deduped);
                      }
                    }}
                    styles={{ input: { fontSize: 12 } }}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Remove program"
                    onClick={() => removeProgramPathAtIndex(idx)}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </div>

            <Divider my="md" label="Speech-to-text" labelPosition="left" />

            <div className="settings-row">
              <div>
                <p className="settings-label">Speech-to-Text Provider</p>
                <p className="settings-description">
                  Service for transcribing audio
                </p>
              </div>
              <Select
                data={sttProviderOptions}
                value={localProfileSttProvider}
                onChange={(value) => {
                  if (!value) return;
                  setLocalProfileSttProvider(value);
                  const models = STT_MODELS[value] ?? [];
                  const firstModel = models[0]?.value ?? null;
                  setLocalProfileSttModel(firstModel);
                  saveProfileMetadata({
                    stt_provider: value,
                    stt_model: firstModel,
                  });
                }}
                placeholder="Select provider"
                withCheckIcon={false}
                disabled={
                  isLoading ||
                  (sttCloudProviders.length === 0 &&
                    sttLocalProviders.length === 0)
                }
                styles={{
                  input: {
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-default)",
                    color: "var(--text-primary)",
                    minWidth: 200,
                  },
                }}
              />
            </div>

            {(localProfileSttProvider
              ? STT_MODELS[localProfileSttProvider] ?? []
              : []
            ).length > 0 && (
              <div className="settings-row">
                <div>
                  <p className="settings-label">STT Model</p>
                  <p className="settings-description">
                    Model to use for transcription
                  </p>
                </div>
                <Select
                  data={STT_MODELS[localProfileSttProvider ?? ""] ?? []}
                  value={localProfileSttModel}
                  onChange={(value) => {
                    if (!value) return;
                    setLocalProfileSttModel(value);
                    saveProfileMetadata({ stt_model: value });
                  }}
                  placeholder="Select model"
                  withCheckIcon={false}
                  disabled={isLoading}
                  styles={{
                    input: {
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      minWidth: 200,
                    },
                  }}
                />
              </div>
            )}

            <div className="settings-row">
              <div style={{ flex: 1 }}>
                <p className="settings-label">STT Timeout</p>
                <p className="settings-description">
                  Increase if nothing is getting transcribed
                </p>
                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Slider
                    value={localProfileSttTimeout}
                    onChange={setLocalProfileSttTimeout}
                    onChangeEnd={(v) => {
                      setLocalProfileSttTimeout(v);
                      saveProfileMetadata({ stt_timeout_seconds: v });
                    }}
                    min={0.5}
                    max={3.0}
                    step={0.1}
                    marks={[
                      { value: 0.5, label: "0.5s" },
                      { value: 3.0, label: "3.0s" },
                    ]}
                    styles={{
                      root: { flex: 1 },
                      track: { backgroundColor: "var(--bg-elevated)" },
                      bar: { backgroundColor: "var(--accent-primary)" },
                      thumb: { borderColor: "var(--accent-primary)" },
                      markLabel: {
                        color: "var(--text-secondary)",
                        fontSize: 10,
                      },
                    }}
                  />
                  <Text size="xs" c="dimmed" style={{ minWidth: 32 }}>
                    {localProfileSttTimeout.toFixed(1)}s
                  </Text>
                </div>
              </div>
            </div>

            <Divider my="md" label="Language model" labelPosition="left" />

            <div className="settings-row">
              <div>
                <p className="settings-label">Rewrite Transcription</p>
                <p className="settings-description">
                  Enable or disable rewriting the transcription with an LLM
                </p>
              </div>
              <Switch
                checked={localProfileRewriteEnabled}
                onChange={(e) => {
                  const enabled = e.currentTarget.checked;
                  setLocalProfileRewriteEnabled(enabled);
                  saveProfileMetadata({ rewrite_llm_enabled: enabled });
                }}
                color="gray"
                size="md"
                disabled={isLoading}
              />
            </div>

            <div className="settings-row">
              <div>
                <p className="settings-label">Language Model Provider</p>
                <p className="settings-description">
                  AI service for text formatting
                </p>
              </div>
              <Select
                data={llmProviderOptions}
                value={localProfileLlmProvider}
                onChange={(value) => {
                  if (!value) return;
                  setLocalProfileLlmProvider(value);
                  const models = LLM_MODELS[value] ?? [];
                  const firstModel = models[0]?.value ?? null;
                  setLocalProfileLlmModel(firstModel);
                  saveProfileMetadata({
                    llm_provider: value,
                    llm_model: firstModel,
                  });
                }}
                placeholder="Select provider"
                withCheckIcon={false}
                disabled={
                  isLoading ||
                  (llmCloudProviders.length === 0 &&
                    llmLocalProviders.length === 0)
                }
                styles={{
                  input: {
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-default)",
                    color: "var(--text-primary)",
                    minWidth: 200,
                  },
                }}
              />
            </div>

            {(localProfileLlmProvider
              ? LLM_MODELS[localProfileLlmProvider] ?? []
              : []
            ).length > 0 && (
              <div className="settings-row">
                <div>
                  <p className="settings-label">Rewrite LLM Model</p>
                  <p className="settings-description">
                    LLM Model used to rewrite the transcription.
                  </p>
                </div>
                <Select
                  data={LLM_MODELS[localProfileLlmProvider ?? ""] ?? []}
                  value={localProfileLlmModel}
                  onChange={(value) => {
                    if (!value) return;
                    setLocalProfileLlmModel(value);
                    saveProfileMetadata({ llm_model: value });
                  }}
                  placeholder="Select model"
                  withCheckIcon={false}
                  disabled={isLoading}
                  styles={{
                    input: {
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      minWidth: 200,
                    },
                  }}
                />
              </div>
            )}

            {isLoading ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "20px",
                }}
              >
                <Loader size="sm" color="gray" />
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <Accordion variant="separated" radius="md">
                  <PromptSectionEditor
                    sectionKey={`${p.id}-main-prompt`}
                    title="Core Formatting Rules"
                    description="Filler word removal, punctuation, capitalization"
                    enabled={true}
                    hideToggle={true}
                    initialContent={localSections!.main.content}
                    defaultContent={defaultSections?.main ?? ""}
                    hasCustom={hasCustomContent.main}
                    onToggle={() => {}}
                    onSave={(content) => handleSave("main", content)}
                    onReset={() => handleReset("main")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />

                  <PromptSectionEditor
                    sectionKey={`${p.id}-advanced-prompt`}
                    title="Advanced Features"
                    description='Backtrack corrections ("scratch that") and list formatting'
                    enabled={localSections!.advanced.enabled}
                    initialContent={localSections!.advanced.content}
                    defaultContent={defaultSections?.advanced ?? ""}
                    hasCustom={hasCustomContent.advanced}
                    onToggle={(checked) => handleToggle("advanced", checked)}
                    onSave={(content) => handleSave("advanced", content)}
                    onReset={() => handleReset("advanced")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />

                  <PromptSectionEditor
                    sectionKey={`${p.id}-dictionary-prompt`}
                    title="Personal Dictionary"
                    description="Custom word mappings for technical terms"
                    enabled={localSections!.dictionary.enabled}
                    initialContent={localSections!.dictionary.content}
                    defaultContent={defaultSections?.dictionary ?? ""}
                    hasCustom={hasCustomContent.dictionary}
                    onToggle={(checked) => handleToggle("dictionary", checked)}
                    onSave={(content) => handleSave("dictionary", content)}
                    onReset={() => handleReset("dictionary")}
                    isSaving={
                      updateCleanupPromptSections.isPending ||
                      updateRewriteProgramPromptProfiles.isPending
                    }
                  />
                </Accordion>
              </div>
            )}

            <Group justify="flex-end" mt="md">
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<Trash2 size={14} />}
                onClick={deleteActiveProfile}
                disabled={
                  isLoading ||
                  updateRewriteProgramPromptProfiles.isPending ||
                  activeProfileId === "default"
                }
              >
                Delete profile
              </Button>
            </Group>
          </Tabs.Panel>
        ))}
      </Tabs>

      <Modal
        opened={windowPickerOpen}
        onClose={() => {
          setWindowPickerOpen(false);
          setWindowPickerDropdownOpened(false);
        }}
        title="Pick an open program"
        centered
      >
        {isLoadingWindows ? (
          <Group justify="center" p="md">
            <Loader size="sm" color="gray" />
          </Group>
        ) : (
          <Select
            searchable
            nothingFoundMessage="No windows found"
            placeholder="Select a window"
            data={windowPickerOptions}
            dropdownOpened={windowPickerDropdownOpened}
            onDropdownOpen={() => setWindowPickerDropdownOpened(true)}
            onDropdownClose={() => setWindowPickerDropdownOpened(false)}
            onChange={(value) => {
              if (!value) return;
              addProgramPathFromPicker(value);
            }}
          />
        )}
      </Modal>
    </>
  );
}
