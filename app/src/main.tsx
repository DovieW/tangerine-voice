import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/code-highlight/styles.css";
import {
  CodeHighlightAdapterProvider,
  createHighlightJsAdapter,
} from "@mantine/code-highlight";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.css";
import "@fontsource/sora/index.css";
import "@fontsource/outfit/index.css";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { darkTheme } from "./theme";

const queryClient = new QueryClient();

hljs.registerLanguage("json", json);
const highlightAdapter = createHighlightJsAdapter(hljs);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CodeHighlightAdapterProvider adapter={highlightAdapter}>
        <MantineProvider theme={darkTheme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <App />
        </MantineProvider>
      </CodeHighlightAdapterProvider>
    </QueryClientProvider>
  </StrictMode>
);
