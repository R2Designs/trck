import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/controls';
import { useTheme } from '@/app/theme';
import type { ThemePreference } from '@/app/theme';

/**
 * Light / Dark / Match device.
 *
 * Presented as a segmented control rather than a single toggle because the
 * three-way choice is the point: "match device" is a real option people want,
 * and a two-state switch cannot express it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  const options: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: t('theme.light'), icon: <Sun className="size-4" aria-hidden /> },
    { value: 'dark', label: t('theme.dark'), icon: <Moon className="size-4" aria-hidden /> },
    { value: 'system', label: t('theme.system'), icon: <Monitor className="size-4" aria-hidden /> },
  ];

  return (
    <SegmentedControl
      className={className}
      label={t('a11y.selectTheme')}
      value={preference}
      onChange={setPreference}
      options={options}
    />
  );
}
