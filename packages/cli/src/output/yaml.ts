import { stringify } from 'yaml';

export function formatYaml(data: unknown): string {
  return stringify(data);
}
