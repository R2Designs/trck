import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Debounced search box.
 *
 * Debouncing is not a nicety here: every keystroke would otherwise be a round
 * trip over a depot-yard connection, and `rpc_search` is deliberately capped
 * rather than paginated. 300 ms covers typing on a phone keyboard while still
 * feeling immediate.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  delay = 300,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in step when the parent resets the value (e.g. "clear filters").
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(draft), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, delay, onChange, value]);

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        inputMode="search"
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder ?? t('actions.search')}
        aria-label={placeholder ?? t('actions.search')}
        className="pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label={t('actions.clear')}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md
            text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
