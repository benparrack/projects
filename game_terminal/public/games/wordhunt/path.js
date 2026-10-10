// Pure swipe-path helpers for Word Hunt (no DOM), shared by the client and the Node test.
export const N = 4;

export const adjacent = (a, b) => a !== b
  && Math.abs(Math.floor(a / N) - Math.floor(b / N)) <= 1 && Math.abs((a % N) - (b % N)) <= 1;

// Path-extension rule for a swipe that has moved onto cell `i`: backing onto the previous cell
// undoes the last step; a touching unused cell extends; anything else is ignored.
export function extendPath(path, i) {
  if (!path.length) return [i];
  const last = path[path.length - 1];
  if (i === last) return path;
  if (path.length >= 2 && i === path[path.length - 2]) return path.slice(0, -1);
  if (path.includes(i) || !adjacent(last, i)) return path;
  return [...path, i];
}
