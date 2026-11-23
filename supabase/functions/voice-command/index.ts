// Supabase Edge Function: voice-command
//
// Modtager en lydoptagelse (base64 WAV) + en kompakt liste over åbne opgaver fra
// index.html / wall.html, sender det til Gemini og returnerer ÉN handling:
// create | update | delete | unclear. Selve ændringen udføres i browseren, efter
// brugeren har trykket OK — funktionen skriver aldrig selv til databasen.
//
// Deploy via dashboardet: Edge Functions → Deploy a new function → navn "voice-command"
// → indsæt denne fil. Sæt derefter secret GEMINI_API_KEY (Edge Functions → Secrets).
// Valgfrit: GEMINI_MODEL (standard: gemini-3.8-flash) og GEMINI_FALLBACK_MODEL
// (standard: gemini-3.5-flash-lite), som bruges hvis hovedmodellen er overbelastet.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type TaskIn = {
  id: string; title: string; deadline?: string; type?: string; underkat?: string;
  prio?: string; parentId?: string | null; done?: boolean;
};
type TypeIn = { id: string; navn: string; underkategorier: string[] };

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING", description: "Ordret transskription af det sagte, på dansk." },
    intent: { type: "STRING", enum: ["create", "update", "delete", "unclear"] },
    targetId: { type: "STRING", description: "id på opgaven der ændres/slettes. Kun ved update/delete." },
    parentId: { type: "STRING", description: "id på hovedopgaven, hvis der oprettes en delopgave." },
    fields: {
      type: "OBJECT",
      description: "Kun de felter brugeren nævner. Ved create er title påkrævet.",
      properties: {
        title: { type: "STRING" },
        desc: { type: "STRING" },
        deadline: { type: "STRING", description: "YYYY-MM-DD. Tom streng fjerner deadline." },
        prio: { type: "STRING", enum: ["high", "mid", "low"] },
        type: { type: "STRING" },
        underkat: { type: "STRING" },
        done: { type: "BOOLEAN" },
      },
    },
    summary: { type: "STRING", description: "Kort dansk opsummering af handlingen til en bekræftelsesboks." },
    question: { type: "STRING", description: "Ved unclear: kort dansk forklaring/opfølgende spørgsmål." },
  },
  required: ["transcript", "intent", "summary"],
};

function buildPrompt(today: string, weekday: string, tasks: TaskIn[], types: TypeIn[]) {
  const typeLines = types
    .map((t) => `- ${t.id} (${t.navn}): underkategorier ${t.underkategorier.join(", ")}`)
    .join("\n");
  const taskLines = tasks
    .map((t) => {
      const bits = [`id=${t.id}`, `"${t.title}"`];
      if (t.parentId) bits.push(`delopgave af id=${t.parentId}`);
      if (t.deadline) bits.push(`deadline ${t.deadline}`);
      if (t.type) bits.push(`type ${t.type}${t.underkat ? "/" + t.underkat : ""}`);
      if (t.prio) bits.push(`prio ${t.prio}`);
      return "- " + bits.join(", ");
    })
    .join("\n");

  return `Du er stemmestyringen i opgaveappen Nooty. Lyt til optagelsen (dansk) og omsæt den til PRÆCIS ÉN handling.

I dag er ${weekday} ${today}. Omregn relative datoer ("fredag", "i morgen", "om en uge", "næste tirsdag", "d. 3.") til YYYY-MM-DD. En ugedag uden "næste" betyder den førstkommende (aldrig i dag eller fortiden).

Handlinger:
- create: ny opgave. "Ny opgave", "husk at", "tilføj", "jeg skal" osv. Hvis brugeren siger det er en delopgave/under en eksisterende opgave, sæt parentId.
- update: ændr en eksisterende opgave (titel, deadline, prioritet, type, beskrivelse, eller "marker som færdig" → done=true / "genåbn" → done=false).
- delete: slet en eksisterende opgave.
- unclear: hvis du ikke kan høre det, det ikke er en opgavekommando, eller flere opgaver passer lige godt til update/delete. Forklar kort i question.

Regler:
- Ved update/delete SKAL targetId være et id fra listen nedenfor. Match på betydning, ikke kun ordret titel. Gæt aldrig et id der ikke står på listen.
- Medtag kun de felter brugeren faktisk nævner. Opfind ikke deadline eller prioritet.
- Titler skrives kort og naturligt med stort begyndelsesbogstav, uden "ny opgave:" foran.
- prio: "vigtig/haster/høj" → high, "lav/ikke vigtig" → low, ellers udelad.
- type/underkat: brug kun værdier fra listen; udelad hvis det ikke er tydeligt.
- summary: én kort dansk sætning, fx 'Opret "Ring til trykkeriet" med deadline fredag 27. nov.' eller 'Slet "Bestil lokale".'

Opgavetyper:
${typeLines}

Åbne opgaver:
${taskLines || "(ingen)"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Kun POST" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "GEMINI_API_KEY er ikke sat som secret på funktionen." }, 500);
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";

  let body: {
    audio?: string; mimeType?: string; today?: string; weekday?: string;
    tasks?: TaskIn[]; types?: TypeIn[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }
  if (!body.audio) return json({ error: "Ingen lyd modtaget" }, 400);

  const tasks = (body.tasks || []).slice(0, 500);
  const prompt = buildPrompt(body.today || "", body.weekday || "", tasks, body.types || []);

  const requestBody = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inline_data: { mime_type: body.mimeType || "audio/wav", data: body.audio } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const callGemini = (m: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: requestBody,
    });

  // Gemini svarer 503 (overbelastet) eller 429 (for mange kald) i perioder. Prøv igen
  // efter en kort pause, og skift derefter til en reservemodel.
  const fallback = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
  const attempts = [model, model, fallback];
  let gRes!: Response;
  for (let i = 0; i < attempts.length; i++) {
    gRes = await callGemini(attempts[i]);
    if (gRes.status !== 503 && gRes.status !== 429 && gRes.status !== 500) break;
    console.warn(`Gemini ${gRes.status} på ${attempts[i]} (forsøg ${i + 1})`);
    if (i < attempts.length - 1) {
      await gRes.body?.cancel();
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }

  if (!gRes.ok) {
    const detail = await gRes.text().catch(() => "");
    console.error("Gemini fejl", gRes.status, detail);
    return json({ error: `Gemini svarede ${gRes.status}`, detail: detail.slice(0, 500) }, 502);
  }

  const gJson = await gRes.json();
  const text = gJson?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  let action: Record<string, unknown>;
  try {
    action = JSON.parse(text);
  } catch {
    return json({ error: "Kunne ikke læse svaret fra Gemini", detail: text.slice(0, 500) }, 502);
  }

  // Sikkerhedsnet: update/delete må kun pege på et id, vi faktisk har sendt med.
  const ids = new Set(tasks.map((t) => String(t.id)));
  if ((action.intent === "update" || action.intent === "delete") && !ids.has(String(action.targetId))) {
    action.intent = "unclear";
    action.question = action.question || "Jeg kunne ikke finde opgaven. Prøv at sige titlen mere præcist.";
  }
  if (action.parentId && !ids.has(String(action.parentId))) delete action.parentId;
  if (action.intent === "create" && !(action.fields as { title?: string })?.title) {
    action.intent = "unclear";
    action.question = action.question || "Jeg fangede ikke, hvad opgaven skal hedde.";
  }

  return json(action);
});
