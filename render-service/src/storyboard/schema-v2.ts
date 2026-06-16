import { z } from 'zod';

export const PanelKind = z.enum(['intro', 'step', 'outro']);
export type PanelKind = z.infer<typeof PanelKind>;

export const Transition = z.enum(['cut', 'fade', 'zoom', 'swipe']);
export type Transition = z.infer<typeof Transition>;

export const ImageTextLabel = z
  .object({
    line1: z.string().min(1),
    line2: z.string().nullable(),
    line3: z.string().nullable(),
  })
  .strict();
export type ImageTextLabel = z.infer<typeof ImageTextLabel>;

export const Ingredient = z
  .object({
    name: z.string().min(1),
    amount: z.string(),
  })
  .strict();
export type Ingredient = z.infer<typeof Ingredient>;

export const Panel = z
  .object({
    index: z.number().int().positive(),
    kind: PanelKind,
    imageTextLabel: ImageTextLabel,
    ingredients: z.array(Ingredient),
    preparation: z.string(),
    purpose: z.string(),
    visualContent: z.string(),
    imagePrompt: z.string().min(1),
    motionDirection: z.string(),
    narrationVi: z.string(),
    onScreenTextVi: z.string(),
    durationSec: z.number().positive(),
    transition: Transition,
  })
  .strict();
export type Panel = z.infer<typeof Panel>;

export const StoryboardV2 = z
  .object({
    schemaVersion: z.literal('v2'),
    dishName: z.string().min(1),
    dishSlug: z.string().regex(/^[a-z0-9-]+$/, 'dishSlug must be ASCII kebab-case'),
    servingSize: z.string(),
    cuisineStyle: z.string(),
    totalDurationSec: z.number().positive(),
    musicMood: z.string(),
    panels: z.array(Panel).min(9, 'panels must have at least 9 entries'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const panels = data.panels;
    const last = panels.length - 1;

    if (panels[0]!.kind !== 'intro') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panels', 0, 'kind'],
        message: 'first panel must have kind="intro"',
      });
    }
    if (panels[last]!.kind !== 'outro') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panels', last, 'kind'],
        message: 'last panel must have kind="outro"',
      });
    }
    for (let i = 1; i < last; i++) {
      if (panels[i]!.kind !== 'step') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['panels', i, 'kind'],
          message: `middle panels must have kind="step" (panel ${i + 1} has "${panels[i]!.kind}")`,
        });
      }
    }

    for (let i = 0; i < panels.length; i++) {
      if (panels[i]!.index !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['panels', i, 'index'],
          message: `index must be ${i + 1}, got ${panels[i]!.index}`,
        });
      }
    }

    const sumDuration = panels.reduce((acc, p) => acc + p.durationSec, 0);
    if (Math.abs(sumDuration - data.totalDurationSec) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalDurationSec'],
        message: `sum(panels[].durationSec)=${sumDuration.toFixed(3)} must equal totalDurationSec=${data.totalDurationSec}`,
      });
    }
  });

export type StoryboardV2 = z.infer<typeof StoryboardV2>;
