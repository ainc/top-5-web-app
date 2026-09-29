// App entry. AG Grid Community has to be registered once before any grid renders.
// BoardProvider loads the saved weeks, and BrowserRouter serves My week and Dashboard.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { App } from "./App";
import { BoardProvider } from "./board";
import "./index.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <BoardProvider>
        <App />
      </BoardProvider>
    </BrowserRouter>
  </StrictMode>,
);
