export function removeDuplicates(path: string): string {
  const parts = path.split('/').filter(part => part !== '');
  return '/' + parts.join('/');
}