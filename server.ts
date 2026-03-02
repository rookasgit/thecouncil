import express from "express";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/env", (req, res) => {
    res.json({ 
      keySet: !!process.env.GEMINI_API_KEY, 
      keyLength: process.env.GEMINI_API_KEY?.length,
      keyPrefix: process.env.GEMINI_API_KEY?.substring(0, 4)
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("GEMINI_API_KEY status:", process.env.GEMINI_API_KEY ? "Set" : "Not set");
  });
}

startServer();
