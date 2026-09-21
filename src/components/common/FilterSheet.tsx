import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  SheetContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Filters in a bottom sheet.
 *
 * At 360 px there is no room for a filter bar, and putting filters in a sheet
 * keeps the list full-width. The trigger carries a count so it is always
 * obvious that a list is filtered — an empty list with invisible filters is
 * one of the more confusing states a product can produce.
 */
export function FilterSheet({
  activeCount,
  onClear,
  children,
  className,
}: {
  activeCount: number;
  onClear?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={activeCount > 0 ? 'secondary' : 'outline'}
          size="md"
          className={cn('shrink-0', className)}
          aria-label={t('a11y.openFilters')}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t('actions.filters')}</span>
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <SheetContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('actions.filters')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">{children}</div>

        <DialogFooter>
          {onClear && activeCount > 0 && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              {t('actions.clearAll')}
            </Button>
          )}
          <DialogClose asChild>
            <Button size="lg">{t('actions.apply')}</Button>
          </DialogClose>
        </DialogFooter>
      </SheetContent>
    </Dialog>
  );
}
