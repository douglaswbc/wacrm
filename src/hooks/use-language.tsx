'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
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

interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: string, count?: number) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLanguageState(readInitialLanguage());
    setReady(true);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    if (!isLanguage(next)) return;
    setLanguageState(next);
    document.documentElement.setAttribute(LANGUAGE_ATTR, next);
    document.documentElement.lang = next === 'pt' ? 'pt-BR' : next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
    }
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
