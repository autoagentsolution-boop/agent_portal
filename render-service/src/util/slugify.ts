// Vietnamese → ASCII kebab-case slug for filesystem-safe paths.
// "Phở Bò" → "pho-bo", "Bò Kho" → "bo-kho"
export const slugify = (s: string): string =>
  s
    .replace(/[Đ]/g, 'D')
    .replace(/[đ]/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
