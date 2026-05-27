import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PublicPricingPage } from "./PublicPricingPage";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

const isPricingRoute = window.location.pathname === "/pricing";

root.render(
  <React.StrictMode>
    {isPricingRoute ? <PublicPricingPage /> : <App />}
  </React.StrictMode>
);


