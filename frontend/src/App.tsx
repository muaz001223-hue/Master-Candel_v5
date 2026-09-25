import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Trade from "@/pages/Trade";
import Workspace from "@/pages/Workspace";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/trade" element={<Trade />} />
      {['signals', 'analytics', 'flow', 'logs', 'settings'].map(path => <Route key={path} path={`/${path}`} element={<Workspace />} />)}
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
