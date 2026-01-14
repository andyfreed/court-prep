import { z } from "zod";

export const SourceRefSchema = z.object({
  ref_type: z.enum([
    "document",
    "transcript_message",
    "email",
    "timeline_event",
    "lawyer_note",
    "user_note",
  ]),
  case_id: z.string(),
  document_version_id: z.string().nullable(),
  transcript_message_ids: z.array(z.string()).nullable(),
  email_id: z.string().nullable(),
  timeline_event_id: z.string().nullable(),
  lawyer_note_id: z.string().nullable(),
  locator: z.object({
    label: z.string(),
    page_start: z.number().nullable(),
    page_end: z.number().nullable(),
    section: z.string().nullable(),
    quote: z.string().nullable(),
    timestamp: z.string().nullable(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ChatResponseSchema = z.object({
  answer: z.object({
    summary: z.string(),
    direct_answer: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    uncertainties: z.array(
      z.object({
        topic: z.string(),
        why: z.string(),
        needed_sources: z.array(z.string()),
      }),
    ),
  }),
  evidence: z.array(
    z.object({
      claim: z.string(),
      source_refs: z.array(SourceRefSchema),
      type: z.enum(["fact", "quote", "comparison"]),
    }),
  ),
  what_helps: z.array(
    z.object({
      point: z.string(),
      source_refs: z.array(SourceRefSchema),
      strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  what_hurts: z.array(
    z.object({
      point: z.string(),
      source_refs: z.array(SourceRefSchema),
      risk_level: z.enum(["high", "medium", "low"]),
    }),
  ),
  next_steps: z.array(
    z.object({
      action: z.string(),
      owner: z.enum(["user", "lawyer", "both"]),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  questions_for_lawyer: z.array(
    z.object({
      question: z.string(),
      why_it_matters: z.string(),
      source_refs: z.array(SourceRefSchema),
    }),
  ),
  missing_or_requested_docs: z.array(
    z.object({
      doc_name: z.string(),
      why: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  meta: z.object({
    used_retrieval: z.boolean(),
    retrieval_notes: z.string(),
    safety_note: z.string(),
  }),
});

const DateString = z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/);

export const TimelineExtractResponseSchema = z.object({
  events: z.array(
    z.object({
      occurred_at: z.union([DateString, z.null()]),
      precision: z.enum(["exact", "approx", "unknown"]),
      title: z.string(),
      summary: z.string(),
      category: z.enum([
        "custody",
        "support",
        "communication",
        "schedule",
        "school",
        "medical",
        "legal",
        "other",
      ]),
      people: z.array(z.string()),
      source_ref: SourceRefSchema,
    }),
  ),
});

export const InsightsResponseSchema = z.object({
  executive_summary: z.array(
    z.object({
      bullet: z.string(),
      source_refs: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  observed_patterns: z.array(
    z.object({
      pattern: z.string(),
      description: z.string(),
      evidence: z.array(
        z.object({
          example: z.string(),
          source_refs: z.array(SourceRefSchema),
        }),
      ),
      pattern_strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  risks_to_me: z.array(
    z.object({
      risk: z.string(),
      why_it_matters: z.string(),
      source_refs: z.array(SourceRefSchema),
      risk_level: z.enum(["high", "medium", "low"]),
    }),
  ),
  potential_issues_other_party: z.array(
    z.object({
      issue: z.string(),
      why_it_matters: z.string(),
      source_refs: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  unknowns_and_what_to_collect: z.array(
    z.object({
      item: z.string(),
      why: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  questions_for_attorney: z.array(
    z.object({
      question: z.string(),
      why_it_matters: z.string(),
      source_refs: z.array(SourceRefSchema),
    }),
  ),
  meta: z.object({
    window: z.object({
      start: z.union([DateString, z.null()]),
      end: z.union([DateString, z.null()]),
    }),
    safety_note: z.string(),
  }),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type TimelineExtractResponse = z.infer<typeof TimelineExtractResponseSchema>;
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;
