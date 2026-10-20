import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./theme.css";
import { PreviewApp } from "./PreviewApp";

createRoot(document.getElementById("root")!).render(<PreviewApp />);
