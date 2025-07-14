export const summarizePreview = (value: any): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return value.length > 50 ? value.slice(0, 47) + '...' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const jsonStr = JSON.stringify(value, null, 0);
  return jsonStr.length > 50 ? jsonStr.slice(0, 47) + '...' : jsonStr;
};