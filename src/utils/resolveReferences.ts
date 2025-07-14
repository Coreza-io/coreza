export const resolveReferences = (expr: string, data: any): string => {
  // Handle node reference pattern: {{ $('NodeName').json.path }}
  return expr.replace(/\{\{\s*\$\('(.+?)'\)\.json\.(.+?)\s*\}\}/g, (match, nodeName, path) => {
    try {
      const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], data);
      return value !== undefined ? String(value) : match;
    } catch {
      return match;
    }
  });
};