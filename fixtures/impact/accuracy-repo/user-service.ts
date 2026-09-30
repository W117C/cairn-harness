export function createUser(name: string): string {
  const label = formatLabel(name);
  logInfo("created " + label);
  return label + ":" + String(add(1, 2));
}
