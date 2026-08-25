'use client';

import { PasswordForm } from './password-form';
import { SessionsCard } from './sessions-card';
import { SettingsPanelHead } from './settings-panel-head';
import { useLanguage } from '@/hooks/use-language';

/**
 * "Login & security" section — groups the former Profile-tab password
 * and active-sessions cards into their own dedicated home.
 */
export function SecurityPanel() {
  const { t } = useLanguage();
  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('settings.security')}
        description={t('security.description')}
      />
      <div className="space-y-4">
        <PasswordForm />
        <SessionsCard />
      </div>
    </section>
  );
}
