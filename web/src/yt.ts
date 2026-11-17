// Loads the YouTube IFrame Player API once. The player reports position and state, which the server uses as watch proof.
let ready: Promise<void> | null = null;

export function loadYT(): Promise<void> {
  const w = window as any;
  if (!ready) {
    ready = new Promise((resolve) => {
      if (w.YT?.Player) return resolve();
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }
  return ready;
}
