import { apiRequest } from './client.js'
import type { SkillCandidate, AgentCandidate, McpServerCandidate, PermissionsCandidate } from './types.js'

export const listSkillCandidates = () => apiRequest<SkillCandidate[]>('/catalog/skills')
export const listAgentCandidates = () => apiRequest<AgentCandidate[]>('/catalog/agents')
export const listMcpCandidates = () => apiRequest<McpServerCandidate[]>('/catalog/mcp-servers')
export const listPermissionCandidates = () => apiRequest<PermissionsCandidate[]>('/catalog/permissions')
