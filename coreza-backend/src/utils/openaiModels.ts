export const OPENAI_SEARCH_MODELS = [
  "gpt-4o-search-preview",
  "gpt-4o-mini-search-preview",
];

export function isSearchModel(model: string): boolean {
  return OPENAI_SEARCH_MODELS.includes(model);
}
