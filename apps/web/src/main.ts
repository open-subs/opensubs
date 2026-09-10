import { mount } from "svelte";
import App from "./App.svelte";
import AccountBadge from "./AccountBadge.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("no #app element to mount into");

// The target is not empty: index.html ships a static rendering of the
// tool's first screen so a crawler sees the tool without running anything
// (APP-48). `mount` appends rather than replaces, so without this the
// skeleton would sit above the real app for the life of the page.
target.replaceChildren();

const app = mount(App, { target });

// The navbar is static HTML -- it sits in the document with the headline
// and the rest of the page, so a crawler reads the copy without running
// anything. Only the account controls inside it need to be live, so only
// they are mounted, into a slot the markup leaves for them.
//
// Optional on purpose: the app is also served on its own during e2e runs
// and in `vite dev` against a page without a navbar, and a missing slot
// must not take the whole app down with it.
const badge = document.getElementById("account");
if (badge) mount(AccountBadge, { target: badge });

export default app;
