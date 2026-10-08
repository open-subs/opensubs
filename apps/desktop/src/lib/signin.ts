// Opening the sign-in window, and hearing back from it.
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { notify } from "@openapps/ui/bundle";

/** Open the sign-in window, or bring it forward if it is already open. */
export async function openSignIn(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("signin");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("signin", {
    url: "index.html?signin",
    title: "Sign in to OpenSubs",
    width: 440,
    height: 680,
    resizable: true,
  });
}

/** Call `onChange` whenever the sign-in window saves a session. The session
 * itself is already in this window's storage, which both windows share;
 * this only says "look again". */
export function onSignedIn(onChange: () => void): Promise<UnlistenFn> {
  return listen("opensubs-session-changed", () => {
    notify();
    onChange();
  });
}
