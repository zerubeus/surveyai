import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Exact form field definitions — keep in sync with Step1Form.tsx
const FORM_SCHEMA = {
  fields: {
    name: {
      type: "string",
      description: "Project name (≤80 chars, specific and informative)",
      example: "WASH Baseline Survey — Northern Region 2025",
    },
    objective_text: {
      type: "string",
      description: "2–3 sentence objective describing what this survey measures and why",
    },
    objective_tags: {
      type: "array of strings",
      description: "Pick up to 3 tags that best describe the survey type",
      allowed_values: [
        "Baseline",
        "Endline",
        "Midline",
        "Needs Assessment",
        "Post-Distribution",
        "KAP Study",
        "Satisfaction Survey",
        "Other",
      ],
    },
    research_questions: {
      type: "array of objects",
      description: "3–5 specific, measurable research questions derived from the data/instrument",
      item_shape: { text: "string", priority: "integer starting at 1" },
    },
    target_population: {
      type: "string",
      description: "Who the survey respondents are (e.g. 'Households in rural districts of northern Mali')",
    },
    sampling_method: {
      type: "string",
      description: "How respondents were selected",
      allowed_values: [
        "simple_random",
        "stratified",
        "cluster",
        "multi_stage",
        "convenience",
        "purposive",
        "snowball",
      ],
    },
    country: {
      type: "string",
      description: "Country name if detectable from data or instrument, else empty string",
    },
    regions: {
      type: "string",
      description: "Regions/states/districts if detectable from data or instrument, else empty string",
    },
    audience: {
      type: "string",
      description: "Primary intended audience for the final report",
      allowed_values: ["donor", "internal", "academic", "government", "public"],
    },
  },
};

export interface AIPrefill {
  name: string;
  objective_text: string;
  objective_tags: string[];
  research_questions: { text: string; priority: number }[];
  target_population: string;
  sampling_method: string;
  country: string;
  regions: string;
  audience: string;
}

interface AnalysisResult {
  suggestions: AIPrefill;
  metadata: {
    headers: string[];
    row_count: number;
    instrument_detected: boolean;
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const csvFile = formData.get("dataset") as File | null;
    const instrumentFile = formData.get("instrument") as File | null;

    if (!csvFile) {
      return NextResponse.json({ error: "Dataset file is required" }, { status: 400 });
    }

    // --- Parse CSV ---
    const csvText = await csvFile.text();
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    const headers = lines[0]?.split(",").map((h) => h.replace(/^["']|["']$/g, "").trim()) ?? [];
    const sampleRows = lines
      .slice(1, 6)
      .map((line) => line.split(",").map((v) => v.replace(/^["']|["']$/g, "").trim()));
    const rowCount = Math.max(0, lines.length - 1);

    // --- Parse instrument (best-effort text extraction) ---
    let instrumentText = "";
    let instrumentDetected = false;
    if (instrumentFile) {
      instrumentDetected = true;
      try {
        const raw = await instrumentFile.text();
        instrumentText = raw.slice(0, 5000);
      } catch {
        try {
          const buf = await instrumentFile.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let text = "";
          let chunk = "";
          for (const b of bytes) {
            if (b >= 32 && b <= 126) {
              chunk += String.fromCharCode(b);
            } else {
              if (chunk.length >= 4) text += chunk + " ";
              chunk = "";
            }
          }
          instrumentText = text.slice(0, 5000);
        } catch {
          instrumentText = "";
        }
      }
    }

    // --- Build Gemini prompt ---
    const sampleCsv = [headers.join(", "), ...sampleRows.map((r) => r.join(", "))].join("\n");

    const prompt = `You are a survey data analyst for humanitarian NGOs. Analyze the dataset below and fill ALL fields in the provided JSON schema.

## Dataset File: ${csvFile.name}
## Columns (${headers.length} total)
${headers.join(", ")}

## Sample Data (first 5 rows)
${sampleCsv}

## Total Rows (approx): ${rowCount}

${instrumentText ? `## Questionnaire / Instrument Content\n${instrumentText}` : "## Questionnaire: Not provided — infer from column names only."}

---

## Form Schema — fill every field with your best inference

${JSON.stringify(FORM_SCHEMA, null, 2)}

---

## Instructions
1. Fill ALL fields. Do not leave any field empty if you can reasonably infer it.
2. For "sampling_method": choose from the allowed_values only. If unclear from the data, default to "cluster" for household surveys or "convenience" if no structure is evident.
3. For "objective_tags": pick 1–3 tags that match best. "Baseline" if first data collection, "Endline" if outcome evaluation, "Needs Assessment" if about identifying problems.
4. For "research_questions": generate 3–5 specific, measurable questions the data could answer based on the column names.
5. For "audience": infer from context — NGO data → "internal" or "donor", academic instrument → "academic", government data → "government", default to "donor".
6. For "country" and "regions": look for geographic column names (region, district, wilaya, governorate, state, province, country) and their sample values.
7. Return ONLY a valid JSON object matching the exact field names above. No markdown, no explanation.`;

    // --- Call Gemini ---
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", errText);
      return NextResponse.json({ error: "AI analysis failed", details: errText }, { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const rawContent = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(rawContent);
    } catch {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { raw = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
      }
    }

    // Normalise and validate each field
    const validSamplingMethods = [
      "simple_random", "stratified", "cluster", "multi_stage",
      "convenience", "purposive", "snowball",
    ];
    const validObjectiveTags = [
      "Baseline", "Endline", "Midline", "Needs Assessment",
      "Post-Distribution", "KAP Study", "Satisfaction Survey", "Other",
    ];
    const validAudiences = ["donor", "internal", "academic", "government", "public"];

    const samplingRaw = String(raw.sampling_method ?? "").toLowerCase().replace(/[- ]/g, "_");
    const samplingMethod = validSamplingMethods.includes(samplingRaw) ? samplingRaw : "cluster";

    const tagsRaw = Array.isArray(raw.objective_tags) ? raw.objective_tags : [];
    const tags = tagsRaw
      .map((t: unknown) => String(t).trim())
      .filter((t: string) => validObjectiveTags.includes(t))
      .slice(0, 3);

    const audienceRaw = String(raw.audience ?? "").toLowerCase();
    const audience = validAudiences.includes(audienceRaw) ? audienceRaw : "donor";

    const rqsRaw = Array.isArray(raw.research_questions) ? raw.research_questions : [];
    const researchQuestions = rqsRaw
      .slice(0, 5)
      .map((rq: unknown, i: number) => ({
        text: typeof rq === "string" ? rq : String((rq as Record<string, unknown>)?.text ?? ""),
        priority: Number((rq as Record<string, unknown>)?.priority ?? i + 1),
      }))
      .filter((rq: { text: string }) => rq.text.trim());

    const suggestions: AIPrefill = {
      name: String(raw.name ?? "").trim().slice(0, 80),
      objective_text: String(raw.objective_text ?? "").trim(),
      objective_tags: tags,
      research_questions: researchQuestions,
      target_population: String(raw.target_population ?? "").trim(),
      sampling_method: samplingMethod,
      country: String(raw.country ?? "").trim(),
      regions: String(raw.regions ?? "").trim(),
      audience,
    };

    const result: AnalysisResult = {
      suggestions,
      metadata: {
        headers,
        row_count: rowCount,
        instrument_detected: instrumentDetected,
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("analyze-uploads error:", err);
    return NextResponse.json(
      { error: "Analysis failed", details: String(err) },
      { status: 500 }
    );
  }
}
