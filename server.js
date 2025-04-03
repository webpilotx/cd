import "dotenv/config";
import express from "express";
import ViteExpress from "vite-express";

const app = express();

const PORT = process.env.PORT || 3000;

ViteExpress.listen(app, PORT, () =>
  console.log(`Server is listening on port ${PORT}...`)
);
