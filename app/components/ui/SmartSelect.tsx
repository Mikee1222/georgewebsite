'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import * as SelectPrimitive from '@radix-ui/react-select';

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export interface SmartSelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Legacy alias for SmartSelectItem */
export type SmartSelectOption = SmartSelectItem;

const EMPTY_SENTINEL = 'empty';
/** Sentinel for "no selection" – never pass empty string to Radix Select.Item */
const UNSET_SENTINEL = 'unset';

export default function SmartSelect({
  label,
  value,
  onValueChange,
  onChange,
  items: itemsProp,
  options,
  searchable = false,
  placeholder = 'Select…',
  disabled = false,
  allowClear = true,
  className = '',
  'aria-describedby': ariaDescribedby,
}: {
  label?: string;
  value?: string | null;
  onValueChange?: (v: string | null) => void;
  onChange?: (v: string) => void;
  items?: SmartSelectItem[];
  options?: SmartSelectOption[];
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  'aria-describedby'?: string;
}) {
  const items = itemsProp ?? options ?? [];
  const onValueChangeFn = onValueChange ?? (v => onChange?.(v ?? ''));

  const validItems = items.filter(
    o => typeof o.value === 'string' && o.value.trim().length > 0 && o.value !== UNSET_SENTINEL && o.value !== EMPTY_SENTINEL
  );

  const emptyLabel = validItems.length === 0 && items.length === 1 && items[0]?.value === EMPTY_SENTINEL ? items[0].label : 'No options';
  const clearOptionLabel = '—';
  const displayOptions: SmartSelectItem[] = [
    ...(allowClear ? [{ value: UNSET_SENTINEL, label: clearOptionLabel, disabled: false }] : []),
    ...validItems,
    ...(validItems.length === 0 ? [{ value: EMPTY_SENTINEL, label: emptyLabel, disabled: true }] : []),
  ];

  const radixValue: string =
    value == null || value === ''
      ? allowClear
        ? UNSET_SENTINEL
        : validItems[0]?.value ?? EMPTY_SENTINEL
      : String(value);

  const handleValueChange = (v: string) => {
    if (v === EMPTY_SENTINEL) return;
    onValueChangeFn(v === UNSET_SENTINEL ? null : v);
  };

  const useSearch = searchable || validItems.length > 8;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const filtered = useSearch
    ? validItems.filter(
        o =>
          o.label.toLowerCase().includes(filter.toLowerCase()) ||
          o.value.toLowerCase().includes(filter.toLowerCase())
      )
    : validItems;

  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setDropdownRect(null);
      return;
    }
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inTrigger && !inDropdown) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const selectedLabel =
    radixValue === UNSET_SENTINEL ? placeholder : displayOptions.find(o => o.value === radixValue)?.label ?? placeholder;
  const hasValue = value != null && value !== '' && value !== UNSET_SENTINEL;

  const triggerClassName = 'glass-input flex min-w-0 items-center justify-between gap-2 disabled:opacity-50';

  if (useSearch) {
    const searchOptions =
      radixValue === UNSET_SENTINEL && allowClear
        ? [{ value: UNSET_SENTINEL, label: clearOptionLabel }, ...filtered]
        : filtered;
    const dropdownContent = open && dropdownRect && typeof document !== 'undefined' && (
      <div
        ref={dropdownRef}
        className="fixed pointer-events-auto rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-xl shadow-black/30 backdrop-blur-xl text-white"
        style={{
          top: dropdownRect.top,
          left: dropdownRect.left,
          minWidth: dropdownRect.width,
          width: 'max-content',
          maxWidth: 'min(90vw, 360px)',
          maxHeight: 'min(320px, 80vh)',
          zIndex: 9999,
          overflowX: 'visible',
          overflowY: 'auto',
        }}
        role="listbox"
        onWheelCapture={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMoveCapture={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search…"
          className="glass-input mx-1 mb-2 h-9 w-[calc(100%-0.5rem)] min-w-0"
          autoFocus
          onKeyDown={e => e.stopPropagation()}
        />
        <div
          className="max-h-[280px] overflow-y-auto overscroll-contain touch-pan-y scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
          style={{ minHeight: 0 }}
          onWheelCapture={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {searchOptions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/60">No matches</p>
          ) : (
            searchOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={radixValue === opt.value}
                disabled={opt.disabled}
                onClick={() => {
                  if (opt.disabled) return;
                  handleValueChange(opt.value);
                  setOpen(false);
                }}
                className={`flex h-10 w-full min-w-0 items-center rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors duration-150 disabled:opacity-50 ${
                  radixValue === opt.value
                    ? 'bg-white/10 text-white'
                    : 'text-white/80 hover:bg-white/8 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      </div>
    );
    return (
      <div ref={containerRef} className={`relative ${className}`}>
        {label && <label className="glass-label mb-1.5">{label}</label>}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => !disabled && setOpen(o => !o)}
          disabled={disabled}
          className={`${triggerClassName} text-left`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={ariaDescribedby}
        >
          <span className={`min-w-0 truncate break-words ${hasValue ? 'text-white/90' : 'text-white/60'}`}>{selectedLabel}</span>
          <ChevronDownIcon />
        </button>
        {dropdownContent && createPortal(dropdownContent, document.body)}
      </div>
    );
  }

  return (
    <div className={className}>
      {label && <label className="glass-label mb-1.5">{label}</label>}
      <SelectPrimitive.Root value={radixValue} onValueChange={handleValueChange} disabled={disabled}>
        <SelectPrimitive.Trigger className={triggerClassName} aria-describedby={ariaDescribedby}>
          <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 truncate break-words text-white/90" />
          <SelectPrimitive.Icon>
            <ChevronDownIcon />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="z-[9999] max-h-[320px] overflow-x-visible overflow-y-auto pointer-events-auto rounded-xl border border-white/10 bg-zinc-950/95 shadow-xl shadow-black/30 backdrop-blur-xl min-w-[var(--radix-select-trigger-width)] w-max max-w-[min(90vw,360px)] text-white opacity-0 scale-[0.95] transition-all duration-150 ease-out data-[state=open]:opacity-100 data-[state=open]:scale-100 data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.95]"
            position="popper"
            sideOffset={8}
            collisionPadding={12}
            onWheelCapture={(e) => e.stopPropagation()}
            onTouchMoveCapture={(e) => e.stopPropagation()}
          >
            <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-white/60" />
            <SelectPrimitive.Viewport
              className="max-h-[280px] overflow-y-auto overflow-x-visible overscroll-contain touch-pan-y p-1.5 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
              onWheelCapture={(e) => e.stopPropagation()}
              onTouchMoveCapture={(e) => e.stopPropagation()}
            >
              {displayOptions.map(opt => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  className="relative flex h-10 min-w-0 cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm text-white/80 outline-none transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 data-[highlighted]:bg-white/8 data-[highlighted]:text-white data-[state=checked]:bg-white/10 data-[state=checked]:text-white"
                >
                  <SelectPrimitive.ItemText className="whitespace-nowrap">{opt.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-white/60" />
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
