/**
 * Shared glass table class names for consistent header/row/border styling.
 * Use these on <table>, <thead>, <tr>, <th>, <tbody>, <td> so tables are readable on the glass theme.
 */

export const tableWrapper = 'table-wrap-scroll-hint rounded-2xl border border-white/10 overflow-hidden bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl';
export const tableBase = 'w-full min-w-[400px] text-sm border-collapse';
export const theadTr = 'border-b border-white/10 bg-white/6 sticky top-0 z-10';
export const thBase = 'px-3 py-4 text-xs font-semibold uppercase tracking-wider text-white/70 bg-inherit';
export const thLeft = `${thBase} text-left`;
export const thRight = `${thBase} text-right`;
export const tbodyTr = 'border-t border-white/10 hover:bg-white/5 transition-colors';
export const tdBase = 'px-3 py-4 text-white/90';
export const tdMuted = 'px-3 py-4 text-white/70';
export const tdRight = 'px-3 py-4 text-right tabular-nums text-white/90';
