import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initStatusColors } from "./lib/statusColors";
import { initTheme } from "./lib/theme";
import { initUiSettings } from "./lib/uiSettings";
import { initUiZoom } from "./lib/uiZoom";
import "./index.css";

void initTheme();
initUiSettings();
initStatusColors();
initUiZoom();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
