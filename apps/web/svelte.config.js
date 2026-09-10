// Exists so `svelte-check` can find the compiler options.
//
// The app itself does not need this file -- vite.config.ts configures the
// plugin inline and builds fine without it. svelte-check resolves its
// config separately, and without this it reports every component as
// "No Svelte configuration found" and typechecks none of them. Which is
// how `.svelte` files went unchecked while `tsc` reported success: tsc has
// no loader for them and skips them in silence.
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
