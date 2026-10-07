// App entry. AG Grid Community has to be registered once before any grid renders.
// AuthProvider keeps the Google session. BoardProvider loads the saved weeks.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { BoardProvider } from "./board";
import { ThemeProvider } from "./theme";
import "./index.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <BoardProvider>
            <App />
          </BoardProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
