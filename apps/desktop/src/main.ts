import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import SignIn from "./SignIn.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("missing #app mount point");
}

// The sign-in window loads this same page with `?signin`. A query string
// rather than a hash: signing in with Google returns to this page's address
// without its hash, and would otherwise land in the main app.
const signingIn = new URLSearchParams(window.location.search).has("signin");

export default mount(signingIn ? SignIn : App, { target });
