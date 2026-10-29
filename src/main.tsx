import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initStatusColors } from "./lib/statusColors";
import { initTheme } from "./lib/theme";
import { initUiSettings } from "./lib/uiSettings";
import "./index.css";

void initTheme();
initUiSettings();
initStatusColors();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
