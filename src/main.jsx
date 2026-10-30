import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import App from "./App.jsx";

async function boot() {
  let Root = App;
  // Phase 1 IPC harness, dev builds only: http://localhost:1420/?harness
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("harness")) {
    Root = (await import("./dev/Harness.jsx")).default;
  }
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
}
boot();
