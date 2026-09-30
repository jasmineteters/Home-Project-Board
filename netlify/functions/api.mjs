// Netlify Function: every /api/* request goes through here. Data lives in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/board.mjs";

export default async (req) => {
  const store = getStore({ name: "house-ready-board", consistency: "strong" });
  return handle(req, store, { BOARD_PASSWORD: Netlify.env.get("BOARD_PASSWORD"), BOARD_SECRET: Netlify.env.get("BOARD_SECRET") });
};

export const config = { path: "/api/*" };
