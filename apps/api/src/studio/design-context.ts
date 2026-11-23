/**
 * What every agent receives as its "design system" context: DESIGN.md, the tokens it must use and
 * the team's knowledge base. Shared by design runs and "Test this agent" so a test is faithful.
 */
export function designContext(designMd: string, tokensCss: string, knowledgeMd: string): string {
  const base = `${designMd}\n\n## tokens.css (use these CSS variables)\n\`\`\`css\n${tokensCss}\n\`\`\``;
  return knowledgeMd ? `${base}\n\n${knowledgeMd}` : base;
}
