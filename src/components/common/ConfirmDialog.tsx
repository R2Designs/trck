import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  SheetContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';

/**
 * Confirmation, optionally with a mandatory reason.
 *
 * The reason field is not decoration: deactivating a manager, deleting
 * biometric data and finishing a trip without its end reading all land in the
 * audit log, and an entry that says only "someone did this" is worth very
 * little six months later.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  requireReason,
  reasonLabel,
  reasonHint,
  minReasonLength = 5,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  minReasonLength?: number;
  loading?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const reasonTooShort = Boolean(requireReason) && reason.trim().length < minReasonLength;

  const confirm = async () => {
    if (reasonTooShort) {
      setTouched(true);
      return;
    }
    await onConfirm(requireReason ? reason.trim() : undefined);
    setReason('');
    setTouched(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setTouched(false);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {requireReason && (
          <Field
            label={reasonLabel ?? t('anomalies.review.notes')}
            hint={reasonHint}
            error={touched && reasonTooShort ? t('validation.required') : undefined}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setTouched(true)}
                invalid={touched && reasonTooShort}
              />
            )}
          </Field>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="lg">
              {cancelLabel ?? t('actions.cancel')}
            </Button>
          </DialogClose>
          <Button
            size="lg"
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            loading={loading}
            onClick={() => void confirm()}
          >
            {confirmLabel ?? t('actions.confirm')}
          </Button>
        </DialogFooter>
      </SheetContent>
    </Dialog>
  );
}
