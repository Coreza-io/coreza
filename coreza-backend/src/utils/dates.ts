/**
 * Convert date string to ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ)
 * Handles multiple input formats:
 * - "2025-11-06 01:30:00" -> "2025-11-06T01:30:00Z"
 * - "2025-11-06" -> "2025-11-06T00:00:00Z"
 * - "2025-11-06T01:30:00Z" -> "2025-11-06T01:30:00Z" (already ISO)
 */
export function convertToISO8601(dateStr: string): string {
  if (!dateStr || dateStr.trim() === '') return dateStr;

  const trimmed = dateStr.trim();

  // Already in ISO 8601 format (has T and ends with Z)
  if (trimmed.includes('T') && trimmed.endsWith('Z')) {
    return trimmed;
  }

  // Format: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm:ss.SSS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
    // Replace space with T and add Z
    return trimmed.replace(' ', 'T') + 'Z';
  }

  // Format: "YYYY-MM-DD" (date only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }

  // Fallback: try parsing as Date and convert to ISO
  try {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (error) {
    console.error('Date conversion error:', error);
  }

  // Return original if we can't convert
  return trimmed;
}
