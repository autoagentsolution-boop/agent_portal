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
  | 'scheduled'
  // Hidden super-admin console — reachable only by the /superadminatria101 URL, never in the nav.
  | 'super-admin';
