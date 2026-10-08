<script lang="ts">
  // The sign-in window. Signing in with Google sends this whole window to
  // Google and back, so it happens here rather than in the main window,
  // which would lose the video and settings it is holding. When the
  // session is saved, the main window is told and this one closes.
  import { onMount } from "svelte";
  import { emit } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { account } from "./lib/account";
  import "@openapps/ui/bundle";

  let container: HTMLDivElement | null = null;

  async function finish() {
    await emit("opensubs-session-changed");
    await invoke("close_window");
  }

  onMount(() => {
    const client = account();
    // A saved session may have expired; only a session the server still
    // accepts counts as signed in.
    if (client.isLoggedIn) {
      client.auth
        .me()
        .then(() => finish())
        .catch(() => client.clearSession());
    }
    const onLogin = () => void finish();
    container?.addEventListener("openapps-login", onLogin);
    return () => container?.removeEventListener("openapps-login", onLogin);
  });
</script>

<div bind:this={container} class="signin-shell">
  <openapps-login
    variant="panel"
    mark="▭"
    heading="Sign in to OpenSubs"
    description="Your account holds the credits for cloud translation, on every computer you sign in on. Everything else works without it."
  ></openapps-login>
</div>

<style>
  .signin-shell {
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: var(--space-6);
  }
</style>
