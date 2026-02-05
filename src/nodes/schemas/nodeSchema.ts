import { z } from "zod";

export const HandleSchema = z.object({
  type: z.enum(["source", "target"]),
  position: z.enum(["left", "right", "top", "bottom"]),
  id: z.string().min(1),
});

export const OptionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    method: z.string().optional(),
    label: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .refine((data) => data.id || data.value !== undefined || data.label || data.name, {
    message: "Option must have at least id, value, label, or name",
  });

export const GroupedOptionsSchema = z.record(
  z.string(),
  z.object({
    label: z.string(),
    icon: z.string().optional(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      })
    ),
  })
);

export const SubFieldSchema = z.object({
  key: z.string().min(1),
  type: z.string(),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  options: z.array(OptionSchema).optional(),
  groupedOptions: GroupedOptionsSchema.optional(),
});

const DisplayValueSchema = z.union([z.string(), OptionSchema, z.record(z.string(), z.any())]);

export const DisplayOptionsSchema = z.object({
  show: z.record(z.string(), z.union([z.array(DisplayValueSchema), DisplayValueSchema])).optional(),
  hide: z.record(z.string(), z.union([z.array(DisplayValueSchema), DisplayValueSchema])).optional(),
});

export const ConditionSchema = z.object({
  field: z.string(),
  value: z.union([z.boolean(), z.string(), z.number()]),
});

export const ConditionalOptionsSchema = z.record(z.string(), z.array(OptionSchema));

export const DynamicOptionsSchema = z.object({
  dependsOn: z.string(),
  optionsByValue: z.record(z.string(), z.array(OptionSchema)),
});

export const DynamicLabelSchema = z.object({
  dependsOn: z.string(),
  labelsByValue: z.record(z.string(), z.string()),
});

export const FieldSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum([
    "text",
    "textarea",
    "select",
    "checkbox",
    "number",
    "password",
    "repeater",
    "toggle",
    "multiselect",
    "webhookUrl",
    "tags",
    "json",
    "grouped-select",
    "hidden",
    "string",
  ]),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  options: z.array(OptionSchema).optional(),
  optionsSource: z.string().optional(),
  optionsApiUrl: z.string().optional(),
  dependsOn: z.string().optional(),
  dynamicLabel: z.union([z.string(), DynamicLabelSchema]).optional(),
  conditionalOptions: ConditionalOptionsSchema.optional(),
  dynamicOptions: DynamicOptionsSchema.optional(),
  hidden: z.boolean().optional(),
  subFields: z.array(SubFieldSchema).optional(),
  displayOptions: DisplayOptionsSchema.optional(),
  condition: ConditionSchema.optional(),
  description: z.string().optional(),
  groupedOptions: GroupedOptionsSchema.optional(),
});

export const AuthFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum(["text", "password", "select", "static"]),
  value: z.string().optional(),
  default: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
});

export const ActionSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).or(z.string()),
});

export const SizeSchema = z.object({
  width: z.number().min(100).max(800),
  height: z.number().min(100).max(800),
});

export const OutputSchema = z.record(z.string(), z.any());

export const StreamingConfigSchema = z.object({
  waitForFirstEvent: z.boolean().optional(),
  timeout: z.number().optional(),
  listeningFlag: z.string().optional(),
  subscribeListeningFlag: z.string().optional(),
  recoveryPolling: z
    .object({
      endpoint: z.string().optional(),
      interval: z.number().optional(),
    })
    .optional(),
});

export const NodeConfigSchema = z
  .object({
    name: z.string().min(1),
    node_type: z.enum(["main", "sub", "trigger", "backtest", "schwab"]),
    handles: z.array(HandleSchema).min(1),
    fields: z.array(FieldSchema),

    def: z.string().optional(),
    label: z.string().optional(),
    category: z.string().optional(),
    subCategory: z.string().optional(),
    subcategory: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    size: SizeSchema.optional(),
    parentNode: z.string().optional(),
    type: z.string().optional(),
    streamingConfig: StreamingConfigSchema.optional(),

    action: ActionSchema.optional(),

    auth: z.string().optional(),
    authFields: z.array(AuthFieldSchema).optional(),
    authAction: ActionSchema.optional(),

    executionMode: z.string().optional(),
    output: OutputSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.node_type === "trigger") {
        return data.handles.every((h) => h.type === "source");
      }
      return true;
    },
    { message: "Trigger nodes should only have source handles" }
  )
  .refine(
    (data) => data.handles.length >= 1,
    { message: "Node must have at least one handle" }
  );

export type NodeConfig = z.infer<typeof NodeConfigSchema>;
