'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Language } from '@/lib/i18n/types';
import { t as translate } from '@/lib/i18n';

const STORAGE_KEY = 'wacrm-language';
const DEFAULT_LANGUAGE: Language = 'en';
const ALL_LANGUAGES: Language[] = ['pt', 'es', 'en'];
const LANGUAGE_ATTR = 'data-language';

function readInitialLanguage(): Language {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE;
  const fromAttr = document.documentElement.getAttribute(LANGUAGE_ATTR);
  if (isLanguage(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
  }
  return DEFAULT_LANGUAGE;
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && ALL_LANGUAGES.includes(value as Language);
}

// Module-level store so the language survives across provider remounts
// and can be read synchronously via useSyncExternalStore (hydration-safe:
// React renders with getServerSnapshot first, then adopts the client value).
let currentLanguage: Language | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Language {
  if (currentLanguage === null) {
    currentLanguage = readInitialLanguage();
  }
  return currentLanguage;
}

function getServerSnapshot(): Language {
  return DEFAULT_LANGUAGE;
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: string, count?: number) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Keep the <html> attributes in sync with the active language.
  useEffect(() => {
    document.documentElement.setAttribute(LANGUAGE_ATTR, language);
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    if (!isLanguage(next)) return;
    currentLanguage = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
    }
    listeners.forEach((notify) => notify());
  }, []);

  const t = useCallback(
    (key: string, count?: number) => translate(key, language, count),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
