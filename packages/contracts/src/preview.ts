import { z } from 'zod';

/**
 * Studio ↔ preview messages (PREVIEW_COMMUNICATION_PROTOCOL.md). Both sides post only to the exact
 * peer origin and validate every message with these schemas; nothing is evaluated from a message
 * except screen source the studio itself fetched from the API.
 */
export const PREVIEW_PROTOCOL = 1;

export const previewModeSchema = z.enum(['design', 'play']);
export type PreviewMode = z.infer<typeof previewModeSchema>;

const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** Studio → preview. */
export const toPreviewSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('render'),
    protocol: z.literal(PREVIEW_PROTOCOL),
    path: z.string().max(300),
    code: z.string().max(512 * 1024),
    tokensCss: z.string().max(100 * 1024),
    mode: previewModeSchema,
  }),
  z.object({ type: z.literal('mode'), mode: previewModeSchema }),
  z.object({ type: z.literal('clearSelection') }),
  /** Select the element at this source location (from the Layers panel). */
  z.object({
    type: z.literal('selectLoc'),
    line: z.number().int().min(1),
    column: z.number().int().min(0),
  }),
  /** Run the automated Verify checks (accessibility + design system) on the rendered screen. */
  z.object({ type: z.literal('verify') }),
]);
export type ToPreview = z.infer<typeof toPreviewSchema>;

export const selectedElementSchema = z.object({
  path: z.string().max(300),
  line: z.number().int().min(1),
  column: z.number().int().min(0),
  tag: z.string().max(40),
  className: z.string().max(2000),
  /** Present only when the element contains text and no child elements (editable text). */
  text: z.string().max(2000).nullable(),
  attributes: z.record(z.string().max(40), z.string().max(500)),
  rect,
  computed: z.object({
    display: z.string().max(40),
    fontSize: z.string().max(20),
    fontWeight: z.string().max(10),
    color: z.string().max(60),
    backgroundColor: z.string().max(60),
  }),
});
export type SelectedElement = z.infer<typeof selectedElementSchema>;

/** One element in a screen's layer tree, located in the screen's source. */
export interface LayerNode {
  line: number;
  column: number;
  tag: string;
  /** Short visible text or a useful attribute, for the layer's name. */
  label: string;
  children: LayerNode[];
}
export const MAX_LAYERS = 2000;
export const layerNodeSchema: z.ZodType<LayerNode> = z.lazy(() =>
  z.object({
    line: z.number().int().min(1),
    column: z.number().int().min(0),
    tag: z.string().max(40),
    label: z.string().max(80),
    children: z.array(layerNodeSchema).max(500),
  }),
);

export const VERIFY_SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;
export const verifySeveritySchema = z.enum(VERIFY_SEVERITIES);
export type VerifySeverity = z.infer<typeof verifySeveritySchema>;
export const MAX_VERIFY_ISSUES = 200;

/**
 * One finding of the Verify checks. `line`/`column` locate the element (or its nearest located
 * ancestor) in the screen's source, as `data-core-loc`; both are absent when nothing is located.
 */
export const verifyIssueSchema = z.object({
  /** The rule: an axe-core rule id or a `ds-*` design-system rule. */
  id: z.string().min(1).max(80),
  severity: verifySeveritySchema,
  category: z.enum(['accessibility', 'design-system']),
  message: z.string().max(300),
  help: z.string().max(300),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(0).optional(),
});
export type VerifyIssue = z.infer<typeof verifyIssueSchema>;

/** Preview → studio. */
export const fromPreviewSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), protocol: z.literal(PREVIEW_PROTOCOL) }),
  z.object({ type: z.literal('rendered'), path: z.string().max(300) }),
  z.object({ type: z.literal('select'), element: selectedElementSchema }),
  z.object({
    type: z.literal('navigate'),
    /** A screen route, or "back". */
    route: z.string().max(120),
    transition: z.enum(['instant', 'dissolve']).default('instant'),
  }),
  z.object({ type: z.literal('error'), message: z.string().max(2000) }),
  z.object({
    type: z.literal('tree'),
    path: z.string().max(300),
    nodes: z.array(layerNodeSchema).max(500),
  }),
  z.object({
    type: z.literal('verifyResult'),
    path: z.string().max(300),
    issues: z.array(verifyIssueSchema).max(MAX_VERIFY_ISSUES),
    checkedAt: z.iso.datetime(),
    /** Set when the checks could not run (no rendered screen, play mode, engine failure). */
    error: z.string().max(300).optional(),
  }),
]);
export type FromPreview = z.infer<typeof fromPreviewSchema>;
