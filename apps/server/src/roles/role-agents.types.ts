export interface RoleAgent {
  id: number
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
}

export interface RoleAgentInput {
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
}
