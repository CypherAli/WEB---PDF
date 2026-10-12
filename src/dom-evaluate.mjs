import {navigationRoots,questionRoots,visibleBounds} from './dom.mjs';
// Playwright serializes a function without its module closure. Include the
// trusted local helper explicitly in its body; never compile website text.
const cache=new WeakMap();
export function domFunction(fn) {
  if(!cache.has(fn)) cache.set(fn,new Function('arg',`${navigationRoots.toString()}\n${questionRoots.toString()}\n${visibleBounds.toString()}\nreturn (${fn.toString()})(arg);`));
  return cache.get(fn);
}
