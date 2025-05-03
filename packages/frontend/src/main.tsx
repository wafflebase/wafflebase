import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// TODO(hackerwins): Add StrictMode to the app.
createRoot(document.getElementById("root")!).render(<App />);
