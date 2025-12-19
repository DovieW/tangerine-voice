import { Accordion, Loader, Switch } from "@mantine/core";
import { useEffect, useState } from "react";
import {
  useDefaultSections,
  useSettings,
  useUpdateCleanupPromptSections,
  useUpdateRewriteLlmEnabled,
} from "../../lib/queries";
import { type CleanupPromptSections, tauriAPI } from "../../lib/tauri";
import { PromptSectionEditor } from "./PromptSectionEditor";

const DEFAULT_SECTIONS: CleanupPromptSections = {
  main: { enabled: true, content: null },
  advanced: { enabled: true, content: null },
  dictionary: { enabled: false, content: null },
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

export function PromptSettings() {
  const { data: settings, isLoading: isLoadingSettings } = useSettings();
  const { data: defaultSections, isLoading: isLoadingDefaultSections } =
    useDefaultSections();
  const updateCleanupPromptSections = useUpdateCleanupPromptSections();
  const updateRewriteLlmEnabled = useUpdateRewriteLlmEnabled();

  // NOTE: Settings tabs unmount when switching (keepMounted=false). If we render
  // switches immediately, they first render with placeholder values then “jump”
  // once settings load. We avoid that by showing a loader until we have settings
  // + defaults and local state is initialized.
  const [localSections, setLocalSections] = useState<LocalSections | null>(
    null
  );

  useEffect(() => {
    if (settings !== undefined && defaultSections !== undefined) {
      const sections = settings.cleanup_prompt_sections ?? DEFAULT_SECTIONS;
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
  }, [settings, defaultSections]);

  const isLoading =
    isLoadingSettings ||
    isLoadingDefaultSections ||
    settings === undefined ||
    defaultSections === undefined ||
    localSections === null;

  const rewriteLlmEnabled = settings?.rewrite_llm_enabled ?? false;

  const hasCustomContent = {
    main: Boolean(settings?.cleanup_prompt_sections?.main?.content),
    advanced: Boolean(settings?.cleanup_prompt_sections?.advanced?.content),
    dictionary: Boolean(settings?.cleanup_prompt_sections?.dictionary?.content),
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
    updateCleanupPromptSections.mutate(sections, {
      onSuccess: () => {
        tauriAPI.emitSettingsChanged();
      },
    });
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

  return (
    <>
      <div className="settings-row" style={{ marginBottom: 16 }}>
        <div>
          <p className="settings-label">Rewrite Transcription</p>
          <p className="settings-description">
            Enable or disable rewriting the transcription with an LLM
          </p>
        </div>
        {isLoading ? (
          <Loader size="sm" color="gray" />
        ) : (
          <Switch
            checked={rewriteLlmEnabled}
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
        )}
      </div>

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
        <Accordion variant="separated" radius="md">
          <PromptSectionEditor
            sectionKey="main-prompt"
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
            isSaving={updateCleanupPromptSections.isPending}
          />

          <PromptSectionEditor
            sectionKey="advanced-prompt"
            title="Advanced Features"
            description='Backtrack corrections ("scratch that") and list formatting'
            enabled={localSections!.advanced.enabled}
            initialContent={localSections!.advanced.content}
            defaultContent={defaultSections?.advanced ?? ""}
            hasCustom={hasCustomContent.advanced}
            onToggle={(checked) => handleToggle("advanced", checked)}
            onSave={(content) => handleSave("advanced", content)}
            onReset={() => handleReset("advanced")}
            isSaving={updateCleanupPromptSections.isPending}
          />

          <PromptSectionEditor
            sectionKey="dictionary-prompt"
            title="Personal Dictionary"
            description="Custom word mappings for technical terms"
            enabled={localSections!.dictionary.enabled}
            initialContent={localSections!.dictionary.content}
            defaultContent={defaultSections?.dictionary ?? ""}
            hasCustom={hasCustomContent.dictionary}
            onToggle={(checked) => handleToggle("dictionary", checked)}
            onSave={(content) => handleSave("dictionary", content)}
            onReset={() => handleReset("dictionary")}
            isSaving={updateCleanupPromptSections.isPending}
          />
        </Accordion>
      )}
    </>
  );
}
