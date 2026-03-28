import { z } from "zod";

export const OBJECTIVE_TAGS = [
  "Baseline",
  "Endline",
  "Midline",
  "Needs Assessment",
  "Post-Distribution Monitoring",
  "KAP Study",
  "Satisfaction Survey",
  "Other",
] as const;

export const SAMPLING_METHODS = [
  { value: "simple_random", label: "Simple Random" },
  { value: "stratified", label: "Stratified" },
  { value: "cluster", label: "Cluster" },
  { value: "multi_stage", label: "Multi-Stage" },
  { value: "convenience", label: "Convenience" },
  { value: "purposive", label: "Purposive" },
  { value: "snowball", label: "Snowball" },
] as const;

export const REPORT_AUDIENCES = [
  { value: "donor", label: "Donor" },
  { value: "internal", label: "Internal" },
  { value: "government", label: "Government" },
  { value: "academic", label: "Academic" },
  { value: "public", label: "Public" },
] as const;

export const INSTRUMENT_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "ar", label: "Arabic" },
  { value: "pt", label: "Portuguese" },
  { value: "sw", label: "Swahili" },
] as const;

/** Research question templates by study type — shown as one-click suggestions in Step 1 */
export const RQ_TEMPLATES: Record<string, { label: string; questions: string[] }[]> = {
  "Baseline": [
    { label: "Outcome baseline", questions: [
      "What is the current level of [outcome indicator] among [target population]?",
      "What demographic and socio-economic factors are associated with [outcome indicator]?",
    ]},
    { label: "Barriers & enablers", questions: [
      "What are the main barriers to [service/behaviour] access among [target population]?",
      "How do gender and education level relate to barriers to [service/behaviour]?",
    ]},
  ],
  "Endline": [
    { label: "Change over time", questions: [
      "To what extent did [outcome indicator] change between baseline and endline among [target population]?",
      "Which sub-groups showed the greatest improvement in [outcome indicator]?",
    ]},
    { label: "Attribution", questions: [
      "Is there a significant difference in [outcome indicator] between intervention and control groups?",
      "What factors moderate the relationship between programme exposure and [outcome indicator]?",
    ]},
  ],
  "Needs Assessment": [
    { label: "Priority needs", questions: [
      "What are the most significant unmet needs reported by [target population]?",
      "How do priority needs differ by geographic area, gender, or household type?",
    ]},
    { label: "Vulnerability", questions: [
      "Which demographic groups are most vulnerable based on [vulnerability indicators]?",
      "What is the relationship between [livelihood indicator] and [vulnerability indicator]?",
    ]},
  ],
  "KAP Study": [
    { label: "KAP associations", questions: [
      "What is the level of knowledge about [topic] among [target population]?",
      "To what extent does knowledge about [topic] predict reported practices?",
      "What factors are associated with positive attitudes towards [behaviour]?",
    ]},
  ],
  "Satisfaction Survey": [
    { label: "Service satisfaction", questions: [
      "What is the overall satisfaction level with [service] among beneficiaries?",
      "Which service dimensions (quality, timeliness, accessibility) most predict overall satisfaction?",
    ]},
  ],
};

export const projectSchema = z.object({
  name: z
    .string()
    .min(3, "Project name must be at least 3 characters")
    .max(100, "Project name must be at most 100 characters"),
  objective_text: z
    .string()
    .min(10, "Please describe the project objective (at least 10 characters)")
    .max(2000, "Objective text is too long"),
  objective_tags: z
    .array(z.enum(OBJECTIVE_TAGS))
    .min(1, "Select at least one objective tag"),
  research_questions: z
    .array(
      z.object({
        text: z.string().min(5, "Question must be at least 5 characters"),
        priority: z.number().int().min(1).max(5),
      }),
    )
    .min(1, "Add at least one research question")
    .max(5, "Maximum 5 research questions"),
  target_population: z
    .string()
    .min(5, "Please describe the target population")
    .max(1000),
  sampling_method: z.enum([
    "simple_random",
    "stratified",
    "cluster",
    "multi_stage",
    "convenience",
    "purposive",
    "snowball",
  ]),
  geographic_scope: z.object({
    country: z.string().min(2, "Country is required"),
    regions: z.string().optional(),
    urban: z.boolean(),
    rural: z.boolean(),
  }),
  report_audience: z.enum(["donor", "internal", "government", "academic", "public"]),
  instrument_language: z.string().default("en"),
});

export type ProjectFormData = z.infer<typeof projectSchema>;
