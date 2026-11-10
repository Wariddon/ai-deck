import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { LiveApp } from "./LiveApp.jsx";
import "./styles.css";

function Preview() {
  useLayoutEffect(() => { document.getElementById("deck-launch")?.remove(); }, []);
  return <App />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.aiDeck ? <LiveApp /> : <Preview />}
  </React.StrictMode>,
);
