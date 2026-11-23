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
    subtasks: {
      type: "ARRAY",
      description: "Kun ved create: delopgaver i den rækkefølge de skal udføres.",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          deadline: { type: "STRING", description: "YYYY-MM-DD eller udeladt." },
          prio: { type: "STRING", enum: ["high", "mid", "low"] },
          desc: { type: "STRING" },
        },
        required: ["title"],
      },
    },
    summary: { type: "STRING", description: "Kort dansk opsummering af handlingen til en bekræftelsesboks." },
    question: { type: "STRING", description: "Ved unclear: kort dansk forklaring/opfølgende spørgsmål." },
  },
  required: ["transcript", "intent", "summary"],
};

function buildPrompt(
  today: string, weekday: string, tasks: TaskIn[], types: TypeIn[],
  alias: (id: string | null | undefined) => string,
) {
  const typeLines = types
    .map((t) => `- ${t.id} (${t.navn}): underkategorier ${t.underkategorier.join(", ")}`)
    .join("\n");
  const kidCount = new Map<string, number>();
  tasks.forEach((t) => { if (t.parentId) kidCount.set(String(t.parentId), (kidCount.get(String(t.parentId)) || 0) + 1); });
  const taskLines = tasks
    .map((t) => {
      const bits = [`id=${alias(t.id)}`, `"${t.title}"`];
      if (t.parentId) bits.push(`delopgave af id=${alias(t.parentId)}`);
      const kids = kidCount.get(String(t.id));
      if (kids) bits.push(`har ${kids} delopgave${kids === 1 ? "" : "r"}`);
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
  - Nævner brugeren under-/delopgaver eller trin ("der er tre underopgaver", "første...", "derefter..."), læg dem i subtasks – én pr. trin, med egen titel og evt. deadline. Hovedopgaven går i fields.
  - subtasks skal stå i den rækkefølge, de skal udføres. Retter brugeren rækkefølgen undervejs ("de to skal faktisk være før den anden"), så brug den rettede rækkefølge.
  - Et trin uden dato ("kan først sætte dato på senere") får ingen deadline.
  - Vil brugeren tilføje delopgaver til en EKSISTERENDE opgave: intent create, parentId = den opgaves id, fields.title udelades, og delopgaverne lægges i subtasks.
- update: ændr en eksisterende opgave (titel, deadline, prioritet, type, beskrivelse, eller "marker som færdig" → done=true / "genåbn" → done=false).
- delete: slet en eksisterende opgave.
- unclear: hvis du ikke kan høre det, det ikke er en opgavekommando, eller flere opgaver passer lige godt til update/delete. Forklar kort i question.

Regler:
- Ved update/delete SKAL targetId være et id fra listen nedenfor (fx "T3"). Match på betydning, ikke kun ordret titel. Gæt aldrig et id der ikke står på listen.
- "Flyt X til <type>" eller "X skal ligge under <type>" er en update af type (og evt. underkat). "Flyt X til <dato>" er en update af deadline.
- Brugeren kalder typen for "kategori", "type" eller "område". Ord som "kategorien til Kommunikation" betyder fields.type = "kommunikation". fields.underkat bruges KUN til underkategorier fra listen (fx "Intern", "SoMe"), aldrig til en type.
- fields.type skal være typens id fra listen (fx "kommunikation"), ikke dens navn.
- Ved update SKAL mindst ét felt i fields være udfyldt med det, der ændres.
- Har flere opgaver samme titel, så vælg hovedopgaven frem for en delopgave, og den med delopgaver frem for en uden – medmindre brugeren siger andet.
- Medtag kun de felter brugeren faktisk nævner. Opfind ikke deadline eller prioritet.
- Titler skrives kort og naturligt med stort begyndelsesbogstav, uden "ny opgave:" foran.
- prio: "vigtig/haster/høj" → high, "lav/ikke vigtig" → low, ellers udelad.
- type/underkat: brug kun værdier fra listen; udelad hvis det ikke er tydeligt.
- summary: én kort dansk sætning, fx 'Opret "Ring til trykkeriet" med deadline fredag 27. nov.', 'Opret "Foliering af varevogn" med 4 delopgaver.' eller 'Slet "Bestil lokale".'

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
  // Nootys id'er er 16-cifrede tal, som sprogmodeller let kommer til at ændre et ciffer i.
  // Gemini ser derfor korte aliaser (T1, T2, …), som oversættes tilbage efter svaret.
  const toAlias = new Map<string, string>();
  const fromAlias = new Map<string, string>();
  tasks.forEach((t, i) => {
    const a = `T${i + 1}`;
    toAlias.set(String(t.id), a);
    fromAlias.set(a, String(t.id));
  });
  const alias = (id: string | null | undefined) => (id == null ? "" : toAlias.get(String(id)) || String(id));
  const unalias = (v: unknown) => {
    if (v == null || v === "") return v;
    const s = String(v).trim().replace(/^id=/i, "").toUpperCase();
    return fromAlias.get(s) ?? String(v);
  };
  const prompt = buildPrompt(body.today || "", body.weekday || "", tasks, body.types || [], alias);

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

  // Synligt under Edge Functions → voice-command → Logs, så fejl kan spores.
  console.log("Gemini svar:", JSON.stringify({
    intent: action.intent, targetId: action.targetId, parentId: action.parentId,
    fields: action.fields, tasksSent: tasks.length,
  }));

  if (action.targetId != null) action.targetId = unalias(action.targetId);
  if (action.parentId != null) action.parentId = unalias(action.parentId);

  // Sikkerhedsnet: update/delete må kun pege på et id, vi faktisk har sendt med.
  const ids = new Set(tasks.map((t) => String(t.id)));

  // Reserve: passer id'et ikke, så find opgaven ud fra en titel, der står ordret i det sagte.
  if ((action.intent === "update" || action.intent === "delete") && !ids.has(String(action.targetId))) {
    const said = String(action.transcript || "").toLowerCase();
    const kids = new Set(tasks.filter((t) => t.parentId).map((t) => String(t.parentId)));
    let hits = tasks.filter((t) => t.title && t.title.length >= 4 && said.includes(t.title.toLowerCase()));
    // Kortere titler, der er en del af en længere match, fjernes ("Foliering" vs. "Foliering af varevogn")
    hits = hits.filter((h) => !hits.some((o) => o !== h && o.title.length > h.title.length && o.title.toLowerCase().includes(h.title.toLowerCase())));
    if (hits.length > 1) { const top = hits.filter((t) => !t.parentId); if (top.length) hits = top; }
    if (hits.length > 1) { const withKids = hits.filter((t) => kids.has(String(t.id))); if (withKids.length) hits = withKids; }
    if (hits.length === 1) {
      console.log("Titel-reserve valgte:", hits[0].title);
      action.targetId = String(hits[0].id);
    }
  }
  if ((action.intent === "update" || action.intent === "delete") && !ids.has(String(action.targetId))) {
    action.intent = "unclear";
    action.question = action.question || "Jeg kunne ikke finde opgaven. Prøv at sige titlen mere præcist.";
  }
  if (action.parentId && !ids.has(String(action.parentId))) delete action.parentId;
  const subtasks = Array.isArray(action.subtasks)
    ? (action.subtasks as { title?: string }[]).filter((s) => s && s.title)
    : [];
  if (action.intent === "create") action.subtasks = subtasks;
  else delete action.subtasks;
  const addsToExisting = !!action.parentId && subtasks.length > 0;
  if (action.intent === "create" && !(action.fields as { title?: string })?.title && !addsToExisting) {
    action.intent = "unclear";
    action.question = action.question || "Jeg fangede ikke, hvad opgaven skal hedde.";
  }

  return json(action);
});
