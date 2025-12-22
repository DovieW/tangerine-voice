import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordingsAPI } from "./tauri";

export interface RecordingPlayerOptions {
  onError?: (message: string) => void;
}

export interface RecordingPlayerControls {
  toggle: (requestId: string) => Promise<void>;
  isPlaying: (requestId: string) => boolean;
  isLoading: (requestId: string) => boolean;
  stop: () => void;
}

/**
 * Scalable recording playback helper.
 *
 * - Uses a single Audio element per view (so we don't create N <audio> tags for N items).
 * - Caches resolved asset URLs to avoid repeated backend calls.
 * - Ensures only one recording plays at a time (per hook instance).
 */
export function useRecordingPlayer(
  options: RecordingPlayerOptions = {}
): RecordingPlayerControls {
  const { onError } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCacheRef = useRef<
    Map<string, { url: string; kind: "asset" | "blob" }>
  >(new Map());
  const blobUrlsRef = useRef<Set<string>>(new Set());
  // Some WebView environments fail to play asset-protocol WAV URLs (MIME mapping issues).
  // We detect that once and then skip the asset attempt for the rest of the session.
  const assetUrlPlayableRef = useRef<boolean | null>(null);

  const [playingRequestId, setPlayingRequestId] = useState<string | null>(null);
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio();
    audio.preload = "none";

    audio.addEventListener("ended", () => {
      setPlayingRequestId(null);
    });

    audio.addEventListener("pause", () => {
      // If the user pauses via the OS/media controls, reflect it in the UI.
      // (If we are switching recordings, we'll set a new playing id right after.)
      setPlayingRequestId(null);
    });

    audioRef.current = audio;
    return audio;
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlayingRequestId(null);
    setLoadingRequestId(null);
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      stop();
      for (const url of blobUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      blobUrlsRef.current.clear();
      urlCacheRef.current.clear();
      audioRef.current = null;
    };
  }, [stop]);

  const base64ToBlobUrl = useCallback((base64: string): string => {
    // Decode base64 to bytes
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    blobUrlsRef.current.add(url);
    return url;
  }, []);

  const toggle = useCallback(
    async (requestId: string) => {
      const id = requestId.trim();
      if (!id) return;

      const audio = ensureAudio();

      // Toggle pause for the currently playing item
      if (playingRequestId === id && !audio.paused) {
        audio.pause();
        setPlayingRequestId(null);
        return;
      }

      // Pause anything currently playing before switching.
      if (!audio.paused) {
        audio.pause();
      }

      setLoadingRequestId(id);

      try {
        let cached = urlCacheRef.current.get(id) ?? null;
        if (!cached) {
          // If we already learned that asset URLs don't work in this runtime,
          // skip straight to Blob fallback.
          if (assetUrlPlayableRef.current === false) {
            const base64 = await recordingsAPI.getRecordingWavBase64({
              requestId: id,
            });
            cached = base64
              ? { url: base64ToBlobUrl(base64), kind: "blob" }
              : null;
          } else {
            const assetUrl = await recordingsAPI.getRecordingAssetUrl({
              requestId: id,
            });
            cached = assetUrl ? { url: assetUrl, kind: "asset" } : null;
          }

          if (cached) urlCacheRef.current.set(id, cached);
        }

        if (!cached?.url) {
          setPlayingRequestId(null);
          onError?.("No recording found for this request.");
          return;
        }

        // Avoid re-setting src if the same URL is already loaded.
        if (audio.src !== cached.url) {
          audio.src = cached.url;
        }

        try {
          await audio.play();
          setPlayingRequestId(id);
          if (cached.kind === "asset") {
            assetUrlPlayableRef.current = true;
          }
        } catch (e) {
          // If the webview can't play the asset URL (common when MIME mapping is off),
          // fall back to base64+Blob URL.
          const name = (e as { name?: string } | null)?.name;
          if (name === "NotSupportedError" && cached.kind === "asset") {
            assetUrlPlayableRef.current = false;
            const base64 = await recordingsAPI.getRecordingWavBase64({
              requestId: id,
            });
            if (!base64) {
              setPlayingRequestId(null);
              onError?.("No recording found for this request.");
              return;
            }

            const blobUrl = base64ToBlobUrl(base64);
            urlCacheRef.current.set(id, { url: blobUrl, kind: "blob" });
            audio.src = blobUrl;
            await audio.play();
            setPlayingRequestId(id);
          } else {
            throw e;
          }
        }
      } catch (e) {
        setPlayingRequestId(null);
        onError?.(`Failed to play recording: ${String(e)}`);
      } finally {
        setLoadingRequestId(null);
      }
    },
    [ensureAudio, onError, playingRequestId, base64ToBlobUrl]
  );

  return useMemo(
    () => ({
      toggle,
      stop,
      isPlaying: (requestId: string) => playingRequestId === requestId.trim(),
      isLoading: (requestId: string) => loadingRequestId === requestId.trim(),
    }),
    [toggle, stop, playingRequestId, loadingRequestId]
  );
}
