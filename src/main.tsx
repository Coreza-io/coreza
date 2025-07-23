import { createRoot } from 'react-dom/client'
import { preloadIcons } from "@/utils/preloadIcons";
import App from './App.tsx'
import './index.css'

// Preload icons immediately to eliminate loading delays
preloadIcons();

createRoot(document.getElementById("root")!).render(<App />);
