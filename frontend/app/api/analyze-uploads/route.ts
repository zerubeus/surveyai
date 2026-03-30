import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface AIPrefill {
  name: string;
  objective_text: string;
  objective_tags: string[];
  research_questions: { text: string; priority: number }[];
  target_population: string;
  sampling_method: string;
  country: string;
  regions: string;
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
        // Try reading as plain text — works for CSV/TSV/TXT instruments
        const raw = await instrumentFile.text();
        // Take first 4000 chars — enough for Gemini context
        instrumentText = raw.slice(0, 4000);
      } catch {
        // Binary file (PDF/DOCX) — attempt ArrayBuffer read and extract printable chars
        try {
          const buf = await instrumentFile.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // Extract printable ASCII text fragments ≥4 chars
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
          instrumentText = text.slice(0, 4000);
        } catch {
          instrumentText = "";
        }
      }
    }

    // --- Build Gemini prompt ---
    const sampleCsv = [headers.join(", "), ...sampleRows.map((r) => r.join(", "))].join("\n");

    const prompt = `You are a survey data analyst. Based on the uploaded dataset headers and questionnaire content below, suggest project brief fields.

## Dataset Headers (${headers.length} columns)
${headers.join(", ")}

## Sample Data (first 5 rows)
${sampleCsv}

## Total Rows (approx)
${rowCount}

${instrumentText ? `## Questionnaire / Instrument Content\n${instrumentText}` : "## Questionnaire\nNot provided."}

## Task
Generate a JSON object with these fields:
- "name": suggested project name (string, ≤80 chars, informative and specific)
- "objective_text": 2-3 sentence objective describing what this survey aims to measure
- "objective_tags": array of up to 3 relevant tags from ONLY this list: ["Baseline", "Endline", "Needs Assessment", "Impact Evaluation", "KAP Survey", "Food Security", "WASH", "Health", "Education", "Livelihoods", "Protection", "Nutrition"]
- "research_questions": array of 3-5 specific, measurable research questions as objects: [{"text": "...", "priority": 1}]
- "target_population": string describing likely survey respondents based on column names and data
- "sampling_method": one of: "simple_random", "stratified", "cluster", "systematic", "purposive", "snowball", "quota", "convenience"
- "country": country name if detectable from column names or instrument text, else ""
- "regions": regions/states if detectable, else ""

Base your suggestions on column names, sample values, and questionnaire content. Return ONLY valid JSON, no markdown.`;

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
            temperature: 0.3,
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

    let suggestions: AIPrefill;
    try {
      suggestions = JSON.parse(rawContent);
    } catch {
      // Try to extract JSON from raw text
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    // Ensure required shape
    const result: AnalysisResult = {
      suggestions: {
        name: suggestions.name ?? "",
        objective_text: suggestions.objective_text ?? "",
        objective_tags: Array.isArray(suggestions.objective_tags) ? suggestions.objective_tags : [],
        research_questions: Array.isArray(suggestions.research_questions)
          ? suggestions.research_questions.map((rq: { text?: string; priority?: number }, i: number) => ({
              text: typeof rq === "string" ? rq : (rq.text ?? ""),
              priority: rq.priority ?? i + 1,
            }))
          : [],
        target_population: suggestions.target_population ?? "",
        sampling_method: suggestions.sampling_method ?? "simple_random",
        country: suggestions.country ?? "",
        regions: suggestions.regions ?? "",
      },
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
