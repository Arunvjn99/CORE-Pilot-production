import { Cpu, Palette } from 'lucide-react';
import { EmptyState } from '../../components/ui';

export function AiProvidersPage() {
  return (
    <EmptyState icon={<Cpu size={32} />} title="AI providers are not configured yet">
      Connecting OpenAI, Anthropic, Gemini, Azure OpenAI and Ollama with encrypted credentials is
      the next slice. No provider is used until a team admin configures one here.
    </EmptyState>
  );
}

export function DesignSystemsPage() {
  return (
    <EmptyState icon={<Palette size={32} />} title="No design systems registered">
      The CORE design system will be registered once its React component package is available to the
      platform. Only verified packages and versions appear here.
    </EmptyState>
  );
}
