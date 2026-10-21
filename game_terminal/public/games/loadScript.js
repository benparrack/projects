// Loads a classic (non-module) script once and resolves with the global it defines.
export function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(window[global]);
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}
