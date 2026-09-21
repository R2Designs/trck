import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Globe } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  SheetContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LANGUAGES, currentLocale } from '@/i18n';
import type { AppLocale } from '@domain/types.ts';
import { cn } from '@/lib/cn';

/**
 * Language picker.
 *
 * Available in two places by design: on the sign-in screen (before anyone has
 * an account, so the form itself can be read) and in Settings. Each language
 * is listed in its own script — a Kannada speaker is looking for "ಕನ್ನಡ".
 */
export function LanguageSwitcher({
  onChange,
  variant = 'button',
  className,
}: {
  onChange: (locale: AppLocale) => void | Promise<void>;
  variant?: 'button' | 'list';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = currentLocale();

  const select = async (locale: AppLocale) => {
    setOpen(false);
    await onChange(locale);
  };

  const list = (
    <ul className="space-y-2">
      {LANGUAGES.map((language) => {
        const selected = language.code === active;
        return (
          <li key={language.code}>
            <button
              type="button"
              onClick={() => void select(language.code)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex min-h-touch-lg w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3',
                'text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary-muted'
                  : 'border-border bg-card hover:border-primary/40',
              )}
            >
              <span className="min-w-0">
                <span className="block text-base font-semibold">{language.label}</span>
                <span className="block text-xs text-muted-foreground">{language.englishName}</span>
              </span>
              {selected && <Check className="size-5 shrink-0 text-primary" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (variant === 'list') {
    return <div className={className}>{list}</div>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="md"
          className={className}
          aria-label={t('a11y.selectLanguage')}
        >
          <Globe className="size-4" aria-hidden />
          <span>{LANGUAGES.find((l) => l.code === active)?.label ?? i18n.language}</span>
        </Button>
      </DialogTrigger>
      <SheetContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('language.choose')}</DialogTitle>
          <DialogDescription>{t('language.chooseHint')}</DialogDescription>
        </DialogHeader>
        {list}
      </SheetContent>
    </Dialog>
  );
}
