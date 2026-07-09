// Shared app navigation types (extracted so TopNav and App agree without a circular import).
export type Page =
  | 'flows'
  | 'connections'
  | 'product-knowledge'
  | 'leads'
  | 'usage'
  | 'command-center'
  | 'instructions'
  | 'impact'
  | 'scheduled';
