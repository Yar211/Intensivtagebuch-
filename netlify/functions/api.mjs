// Prototyp-Backend: speichert pro Zugangs-Code ein Tagebuch in Netlify Blobs.
// Der Code selbst wird nie gespeichert, nur sein SHA-256-Hash.
import { getStore } from "@netlify/blobs";
import { createHash, randomInt } from "node:crypto";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 Zeichen, ohne 0/O/1/I
const WHO = ["Team", "Angehörige", "Patient:in"];
const MOODS = ["Sonnig", "Ruhig", "Hoffnung", "Anstrengend", "Schwer", "Traurig"];
const EVENTS = ["Besuch da", "Augen geöffnet", "Physio / Mobilisation", "Gespräch möglich",
  "Ruhige Nacht", "Kleiner Fortschritt", "Musik gehört", "Schwieriger Tag"];

const norm = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const keyOf = c => createHash("sha256").update(norm(c)).digest("hex");
const newCode = () => Array.from({ length: 16 }, () => ALPHA[randomInt(ALPHA.length)])
  .join("").replace(/(.{4})(?=.)/g, "$1-");
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const reply = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function clean(e) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date || "")) throw new Error("Das Datum fehlt.");
  const name = str(e.name, 80), text = str(e.text, 5000);
  if (!name || !text) throw new Error("Name und Text sind Pflicht.");
  const photos = (Array.isArray(e.photos) ? e.photos : []).slice(0, 4)
    .filter(p => typeof p === "string" && p.startsWith("data:image/jpeg;base64,") && p.length < 600000);
  return {
    id: Date.now() * 1000 + randomInt(1000), name, text, date: e.date,
    who: WHO.includes(e.who) ? e.who : "Angehörige",
    mood: MOODS.includes(e.mood) ? e.mood : "",
    events: (Array.isArray(e.events) ? e.events : []).filter(x => EVENTS.includes(x)),
    special: str(e.special, 300), photos
  };
}

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "Nur POST erlaubt." }, 405);
  let b;
  try { b = await req.json(); } catch { return reply({ error: "Ungültige Anfrage." }, 400); }
  const db = getStore({ name: "tagebuecher", consistency: "strong" });

  if (b.action === "create") { // nur das Team (PIN aus den Netlify-Umgebungsvariablen)
    const pin = process.env.TEAM_PIN;
    if (!pin) return reply({ error: "Auf dem Server ist noch keine TEAM_PIN gesetzt." }, 503);
    if (b.pin !== pin) return reply({ error: "Team-PIN falsch." }, 403);
    const code = newCode();
    await db.setJSON(keyOf(code), { created: Date.now(), entries: [] });
    return reply({ code });
  }

  if (norm(b.code).length !== 16) return reply({ error: "Code ungültig." }, 401);
  const k = keyOf(b.code);
  const diary = await db.get(k, { type: "json" });
  if (!diary) return reply({ error: "Code ungültig." }, 401);

  try {
    if (b.action === "add") {
      diary.entries.push(clean(b.entry));
      if (JSON.stringify(diary).length > 4500000) throw new Error("Das Tagebuch ist voll – bitte weniger oder kleinere Fotos.");
      await db.setJSON(k, diary);
    } else if (b.action === "delete") {
      diary.entries = diary.entries.filter(e => String(e.id) !== String(b.id));
      await db.setJSON(k, diary);
    } else if (b.action === "wipe") { // Tagebuch komplett löschen
      await db.delete(k);
      return reply({ ok: true });
    } else if (b.action !== "load") {
      return reply({ error: "Unbekannte Aktion." }, 400);
    }
  } catch (err) { return reply({ error: err.message }, 400); }
  return reply({ entries: diary.entries });
};

export const config = { path: "/api" };
