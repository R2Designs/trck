import { config } from '@/app/config';
import type { DashboardReadingProvider } from './types';
import { tesseractDashboardProvider } from './tesseractProvider';
import { mockDashboardProvider } from './mockProvider';

let override: DashboardReadingProvider | null = null;

export function getDashboardReadingProvider(): DashboardReadingProvider {
  if (override) return override;
  return config.ocr.provider === 'mock' ? mockDashboardProvider : tesseractDashboardProvider;
}

export function __setDashboardReadingProvider(provider: DashboardReadingProvider | null): void {
  override = provider;
}

export * from './types';
