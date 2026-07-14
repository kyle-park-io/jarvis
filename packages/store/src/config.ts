import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const StreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  weeklyBudgetHours: z.number().nonnegative(),
  weight: z.number().min(0).max(1).default(0.5),
  workdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  active: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  dailyCapacityHours: z.number().positive().default(8),
  deadlineHorizonDays: z.number().int().positive().default(5),
  fallingBehindPct: z.number().min(0).max(100).default(25),
  droppedBallDays: z.number().int().nonnegative().default(1),
  streams: z.array(StreamSchema).default([]),
});

export type JarvisConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(dataRoot: string): JarvisConfig {
  const file = path.join(dataRoot, 'config.yaml');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed: unknown = parseYaml(raw) ?? {};
  return ConfigSchema.parse(parsed);
}
