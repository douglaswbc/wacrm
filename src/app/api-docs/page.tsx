import type { Metadata } from 'next';
import { ApiDocsClient } from './api-docs-client';

export const metadata: Metadata = {
  title: 'API Documentation — wacrm',
  description: 'Public API documentation for wacrm — endpoints, authentication, scopes, and examples.',
  robots: { index: false, follow: false },
};

export default function ApiDocsPage() {
  return <ApiDocsClient />;
}
