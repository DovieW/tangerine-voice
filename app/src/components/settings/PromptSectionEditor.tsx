import { Accordion, Button, Switch, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";

export interface PromptSectionEditorProps {
	sectionKey: string;
	title: string;
	description: string;
	enabled: boolean;
	initialContent: string;
	defaultContent: string;
	hasCustom: boolean;
	helpText?: string;
	placeholder?: string;
	resetLabel?: string;
	minRows?: number;
	maxRows?: number;
	hideToggle?: boolean;
	onToggle: (enabled: boolean) => void;
	onSave: (content: string) => void;
	onReset: () => void;
	isSaving: boolean;
}

export function PromptSectionEditor({
	sectionKey,
	title,
	description,
	enabled,
	initialContent,
	defaultContent,
	hasCustom,
	helpText,
	placeholder,
	resetLabel = "Reset to Default",
	minRows = 6,
	maxRows = 15,
	hideToggle = false,
	onToggle,
	onSave,
	onReset,
	isSaving,
}: PromptSectionEditorProps) {
	const [content, setContent] = useState(initialContent);
	const [hasChanges, setHasChanges] = useState(false);

	// Sync local content when initialContent changes (e.g., after reset)
	useEffect(() => {
		setContent(initialContent);
		setHasChanges(false);
	}, [initialContent]);

	const handleContentChange = (value: string) => {
		setContent(value);
		setHasChanges(true);
	};

	const handleSave = () => {
		onSave(content);
		setHasChanges(false);
	};

	const handleReset = () => {
		setContent(defaultContent);
		onReset();
		setHasChanges(false);
	};

	return (
    <Accordion.Item value={sectionKey}>
      <Accordion.Control>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            paddingRight: 12,
          }}
        >
          <div>
            <p className="settings-label">{title}</p>
            <p className="settings-description">{description}</p>
          </div>
          {!hideToggle && (
            <div
              // Mantine's Accordion toggles on mouse/pointer down in the control.
              // Stop propagation in *capture* and bubble phases so the switch never
              // triggers expand/collapse.
              onMouseDownCapture={(e) => e.stopPropagation()}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onKeyDownCapture={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Switch
                checked={enabled}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggle(e.currentTarget.checked);
                }}
                color="gray"
                size="md"
              />
            </div>
          )}
        </div>
      </Accordion.Control>
      <Accordion.Panel>
        {helpText && (
          <Text size="xs" c="dimmed" mb="sm">
            {helpText}
          </Text>
        )}
        <Textarea
          value={content}
          onChange={(e) => handleContentChange(e.currentTarget.value)}
          placeholder={placeholder}
          minRows={minRows}
          maxRows={maxRows}
          autosize
          styles={{
            input: {
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              fontFamily: "monospace",
              fontSize: "13px",
            },
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <Button
            variant="subtle"
            color="gray"
            onClick={handleReset}
            disabled={!hasCustom}
          >
            {resetLabel}
          </Button>
          <Button
            color="gray"
            onClick={handleSave}
            disabled={!hasChanges}
            loading={isSaving}
          >
            Save
          </Button>
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
