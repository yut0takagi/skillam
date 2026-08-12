export interface RoleAgent {
  id: number
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath: string
}

export interface RoleAgentInput {
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath?: string
}
