import { NextRequest, NextResponse } from "next/server";

interface AISuggestions {
  name: string;
  objective_text: string;
  objective_tags: string[];
  research_questions: { text: string; priority: number }[];
  target_population: string;
  sampling_method: string;
  country: string;
  regions: string;
}

interface AnalyzeResponse {
  suggestions: AISuggestions;
  metadata: {
    headers: string[];
    row_count: number;
    instrument_detected: boolean;
  };
}

function parseCSV(text: string): {
  headers: string[];
  sample_rows: string[][];
  row_count: number;
} {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const headers = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? [];
  const sample_rows = lines.slice(1, 6).map((line) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, "")),
  );
  // Approximate row count from newlines
  const row_count = Math.max(0, lines.length - 1);
  return { headers, sample_rows, row_count };
}

function extractTextFromBinary(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    // Keep printable ASCII + common whitespace
    if (byte >= 32 && byte <= 126) {
      text += String.fromCharCode(byte);
    } else if (byte === 10 || byte === 13 || byte === 9) {
      text += " ";
    }
  }
  // Collapse multiple spaces and filter noise
  return text.replace(/\s{3,}/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const csvFile = form.get("dataset") as File | null;
    const instrumentFile = form.get("instrument") as File | null;

    if (!csvFile) {
      return NextResponse.json(
        { error: "Dataset file is required" },
        { status: 400 },
      );
    }

    // Parse CSV
    const csvText = await csvFile.text();
    const { headers, sample_rows, row_count } = parseCSV(csvText);

    if (headers.length === 0) {
      return NextResponse.json(
        { error: "Could not parse CSV headers" },
        { status: 400 },
      );
    }

    // Parse instrument if provided
    let instrumentText = "";
    if (instrumentFile) {
      const ext = instrumentFile.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "pdf" || ext === "docx" || ext === "xls" || ext === "xlsx") {
        const buffer = await instrumentFile.arrayBuffer();
        instrumentText = extractTextFromBinary(buffer).slice(0, 3000);
      } else {
        // Try reading as text
        instrumentText = (await instrumentFile.text()).slice(0, 3000);
      }
    }

    // Build sample rows as CSV string
    const sampleCSV = sample_rows
      .map((row) => row.join(", "))
      .join("\n");

    const prompt = `You are a survey data analyst. Based on the uploaded dataset headers and questionnaire content below, suggest project brief fields.

## Dataset Headers
${headers.join(", ")}

## Sample Data (first 5 rows)
${sampleCSV}

## Questionnaire Content (if available)
${instrumentText || "No questionnaire provided"}

## Task
Generate a JSON object with these fields:
- "name": suggested project name (string, <=80 chars)
- "objective_text": 2-3 sentence objective (string)
- "objective_tags": array of relevant tags from: ["Baseline", "Endline", "Needs Assessment", "KAP Study", "Satisfaction Survey", "Midline", "Post-Distribution Monitoring", "Other"]
- "research_questions": array of 3-5 research questions as objects: [{"text": "...", "priority": 1}]
- "target_population": string describing likely target population based on data
- "sampling_method": one of: "simple_random", "stratified", "cluster", "multi_stage", "convenience", "purposive", "snowball"
- "country": country name if detectable, else ""
- "regions": regions/states if detectable, else ""

Base your suggestions on column names, sample values, and questionnaire content. Return ONLY valid JSON.`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      console.error("Gemini API error:", errorText);
      return NextResponse.json(
        { error: "AI analysis failed" },
        { status: 502 },
      );
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let suggestions: AISuggestions;
    try {
      suggestions = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse Gemini response:", rawText);
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 502 },
      );
    }

    const response: AnalyzeResponse = {
      suggestions: {
        name: suggestions.name ?? "",
        objective_text: suggestions.objective_text ?? "",
        objective_tags: suggestions.objective_tags ?? [],
        research_questions: suggestions.research_questions ?? [
          { text: "", priority: 1 },
        ],
        target_population: suggestions.target_population ?? "",
        sampling_method: suggestions.sampling_method ?? "simple_random",
        country: suggestions.country ?? "",
        regions: suggestions.regions ?? "",
      },
      metadata: {
        headers,
        row_count,
        instrument_detected: !!instrumentFile,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Analyze uploads error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
