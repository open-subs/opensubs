// The account elements ship as a self-contained bundle, which carries no
// type declarations of its own. These are the four functions the app calls.
declare module "@openapps/ui/bundle" {
  import type { OpenApps, OpenAppsOptions } from "@openapps/sdk";
  export function configure(options: OpenAppsOptions): OpenApps;
  export function getClient(): OpenApps | null;
  export function onChange(listener: () => void): () => void;
  export function notify(): void;
}
