import type { Language } from '@/lib/i18n/types';

const localeMap: Record<Language, string> = {
  pt: 'pt-BR',
  es: 'es',
  en: 'en-US',
};

export function toLocale(language: Language): string {
  return localeMap[language] ?? 'en-US';
}
