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
]);
export type FromPreview = z.infer<typeof fromPreviewSchema>;
