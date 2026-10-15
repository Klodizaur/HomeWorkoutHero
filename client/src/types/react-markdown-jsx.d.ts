/**
 * React 19's types no longer declare a global `JSX` namespace, but
 * react-markdown 8 still names it — from a .ts file in its package, which
 * skipLibCheck doesn't cover — so `tsc` fails inside node_modules. Point the
 * global name back at React's own.
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}
